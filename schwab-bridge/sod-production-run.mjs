import { buildSodAnalysisRequest, invokeSodAnalysisProvider } from "./sod-analysis-provider.mjs";
import { prepareSodOrchestration } from "./sod-orchestration-core.mjs";
import { buildSodPublicationIntent, reconcileSodPublication, publishCandidateBundleAtomically } from "./sod-candidate-publisher.mjs";
import { sodRequestHash, SOD_TERMINAL_STAGES, safeSodFailureCode } from "./sod-run-store.mjs";
import { sodError } from "./sod-provider-validation.mjs";
import { sanitizeSodTransportDiagnostics } from "./sod-transport-diagnostics.mjs";

export function sodPretradeFingerprint(snapshot, proposals) {
  if (!Array.isArray(snapshot?.candidates)) throw sodError("SOD_PRETRADE_SNAPSHOT_INVALID");
  const ids = new Set(proposals.map(c => c.candidateId));
  // All available fields of relevant versions include lifecycle revision and supersession relationships.
  const relevant = snapshot.candidates.filter(c => ids.has(c.candidateId)).sort((a, b) =>
    a.candidateId.localeCompare(b.candidateId) || a.contractVersion - b.contractVersion);
  return sodRequestHash(relevant);
}
function sanitizedResult(result) {
  const source = result.generationMetadata || {};
  const metadata = { localValidation: source.localValidation === true, responseStatus: source.responseStatus === "completed" ? "completed" : null };
  for (const key of ["provider", "modelRequested", "modelResolved", "responseId", "requestId"]) {
    if (typeof source[key] === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(source[key])) metadata[key] = source[key];
  }
  for (const key of ["generatedAt", "researchRetrievedAt"]) {
    if (typeof source[key] === "string" && Number.isFinite(Date.parse(source[key]))) metadata[key] = new Date(source[key]).toISOString();
  }
  for (const key of ["providerVersion", "webSearchCallCount", "sourceCount", "chartCount", "chartBytes"]) {
    if (Number.isFinite(source[key]) && source[key] >= 0) metadata[key] = source[key];
  }
  if (source.charts) metadata.charts = source.charts.map(c => ({ chartId: c.chartId, contentRef: c.contentRef, sha256: c.sha256 }));
  return { ...result, generationMetadata: metadata };
}
export function sodRunProjection(run) {
  return { runId: run.runId, requestHash: run.requestHash, sourceDate: run.sourceDate,
    generationMode: run.generationMode, stage: run.stage, reason: run.reason || null,
    failureCode: run.failureCode || null, createdAt: run.createdAt, updatedAt: run.updatedAt,
    providerResultHash: run.providerResultHash || null,
    ...(run.providerDiagnostics ? { providerDiagnostics: run.providerDiagnostics } : {}),
    ...(run.result || {}), brokerWriteAuthority: false };
}
export function createSodProductionRunner({ store, provider, chartStore, inboxPath, readPretrade, clock = () => new Date().toISOString(), checkpoint = async () => {} }) {
  async function execute(initial, request) {
    const id = initial.runId;
    let run = initial;
    const advance = async (stage, data) => {
      run = store.append(id, stage, data);
      await checkpoint(stage, run);
    };
    try {
      if (run.stage === "CLAIMED") {
        const chartProvenance = [];
        if (chartStore.describe) for (const chart of request.charts) {
          const descriptor = await chartStore.describe(chart);
          chartProvenance.push({ chartId: descriptor.chartId, contentRef: descriptor.contentRef, sha256: descriptor.sha256 });
        }
        let started = false;
        const beforeProviderRequest = async () => {
          if (started) throw sodError("SOD_RUN_PROVIDER_RETRY_FORBIDDEN");
          started = true;
          await advance("PROVIDER_REQUEST_STARTED", { charts: chartProvenance,
            provider: { identity: provider.providerIdentity || null, version: provider.providerVersion || null, modelRequested: provider.model || null,
              ...(provider.timeoutMs ? { timeoutMs: provider.timeoutMs } : {}) } });
        };
        // Production OpenAI adapter invokes the hook after local request checks, immediately before transport.
        // A generic configured module has no external-transport hook, so mark conservatively before invocation.
        if (provider.providerIdentity !== "openai") await beforeProviderRequest();
        const invocation = await invokeSodAnalysisProvider(provider, request, {
          resolveChart: chartStore.resolve, beforeProviderRequest: started ? null : beforeProviderRequest,
        });
        if (!started) throw sodError("SOD_RUN_PROVIDER_START_MISSING");
        const result = sanitizedResult(invocation.result);
        await advance("PROVIDER_RESULT_DURABLE", { artifactHash: store.putArtifact(result) });
      }
      if (run.stage === "PUBLICATION_COMMITTED") {
        const prepared = store.getArtifact(run.preparedHash);
        await advance("SUCCESS", { result: { ...prepared, publication: run.publication } });
        return sodRunProjection(run);
      }
      const result = store.getArtifact(run.providerResultHash);
      // A committed file can be reconciled even if PRETRADE has since consumed it.
      // Still reacquire authority on every recovery; never revive a stored snapshot.
      if (run.intent) {
        await readPretrade();
        const publication = await reconcileSodPublication({ inboxPath, intent: run.intent });
        if (publication) {
          if (run.stage !== "PUBLICATION_INTENT_RECORDED") throw sodError("SOD_PUBLICATION_RECOVERY_CONFLICT");
          await advance("PUBLICATION_COMMITTED", { publication });
          await advance("SUCCESS", { result: { ...store.getArtifact(run.preparedHash), publication } });
          return sodRunProjection(run);
        }
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = await readPretrade();
        const fingerprint = sodPretradeFingerprint(snapshot, result.candidateProposals);
        await advance("PRETRADE_SNAPSHOT_ACQUIRED", { fingerprint });
        const prepared = await prepareSodOrchestration({ request, invocation: { request, result },
          pretradeSnapshot: snapshot, clock: () => initial.createdAt,
          bundleIdFactory: () => `sod-${request.sourceDate}-${id}` });
        await advance("PREPARED", { artifactHash: store.putArtifact(prepared) });
        if (prepared.status !== "READY_TO_PUBLISH") {
          const fresh = await readPretrade();
          if (sodPretradeFingerprint(fresh, result.candidateProposals) !== fingerprint) continue;
          await advance(prepared.status, { result: { ...prepared, publication: null } });
          return sodRunProjection(run);
        }
        // Avoid fixing an intent to already-obsolete preparation. The mandatory
        // final fence still occurs after durable intent, directly before publication.
        if (sodPretradeFingerprint(await readPretrade(), result.candidateProposals) !== fingerprint) continue;
        const intent = buildSodPublicationIntent({ inboxPath, bundle: prepared.bundle, runId: id });
        await advance("PUBLICATION_INTENT_RECORDED", { intent });
        let publication;
        try {
          publication = await publishCandidateBundleAtomically({ inboxPath, bundle: prepared.bundle,
            idFactory: () => id, expectedIntent: intent,
            beforePublish: async () => {
              await checkpoint("BEFORE_PUBLICATION_FENCE", run);
              if (sodPretradeFingerprint(await readPretrade(), result.candidateProposals) !== fingerprint) {
                throw sodError("SOD_PRETRADE_CHANGED_DURING_PREPARATION");
              }
            },
          });
        } catch (error) {
          if (error.code === "SOD_PRETRADE_CHANGED_DURING_PREPARATION") continue;
          throw error;
        }
        await checkpoint("FILESYSTEM_PUBLICATION", run);
        const evidence = { publicationId: publication.publicationId, finalName: publication.finalName,
          sha256: publication.sha256, byteLength: publication.byteLength };
        await advance("PUBLICATION_COMMITTED", { publication: evidence });
        await advance("SUCCESS", { result: { ...prepared, publication: evidence } });
        return sodRunProjection(run);
      }
      throw sodError("SOD_PRETRADE_CHANGED_DURING_PREPARATION");
    } catch (error) {
      // Test checkpoints emulate process death without falsely recording an ordinary failure.
      if (error?.simulateProcessDeath) throw error;
      run = store.state(id);
      const providerDiagnostics = run.stage === "PROVIDER_REQUEST_STARTED" || error?.providerDiagnostics
        ? sanitizeSodTransportDiagnostics({ ...error?.providerDiagnostics, errorCode: safeSodFailureCode(error) }) : null;
      if (run.stage === "PROVIDER_REQUEST_STARTED") {
        if (["SOD_OPENAI_NETWORK_FAILED", "SOD_OPENAI_TIMEOUT", "SOD_OPENAI_REQUEST_FAILED"].includes(error.code)
          || !error.code?.startsWith("SOD_")) {
          run = store.append(id, "RECOVERY_REQUIRED", { reason: "PROVIDER_OUTCOME_AMBIGUOUS", providerDiagnostics });
          return sodRunProjection(run);
        }
      }
      // Publication may have happened: leave intent/commit recoverable on filesystem or journal errors.
      if (["PUBLICATION_INTENT_RECORDED", "PUBLICATION_COMMITTED"].includes(run.stage)
        && !["SOD_PUBLICATION_RECOVERY_CONFLICT", "SOD_PRETRADE_CHANGED_DURING_PREPARATION"].includes(error.code)) throw sodError(safeSodFailureCode(error));
      if (!SOD_TERMINAL_STAGES.has(run.stage) && run.stage !== "RECOVERY_REQUIRED") {
        run = store.append(id, "FAILED", { failureCode: safeSodFailureCode(error), ...(providerDiagnostics ? { providerDiagnostics } : {}) });
      }
      return sodRunProjection(run);
    }
  }
  return Object.freeze({
    async generate(input) {
      const request = buildSodAnalysisRequest(input);
      const run = store.claim(input.runId, request);
      if (SOD_TERMINAL_STAGES.has(run.stage) || run.stage === "RECOVERY_REQUIRED") return sodRunProjection(run);
      return store.withRunWriter(run.runId, () => execute(run, request));
    },
    status: id => sodRunProjection(store.state(id)),
    abandon(id) {
      if (store.isExecuting(id)) throw sodError("SOD_RUN_ABANDON_NOT_ELIGIBLE");
      return sodRunProjection(store.abandon(id));
    },
  });
}
