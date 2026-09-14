// Explicit opt-in gate. Excluded from all offline package test suites.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createOpenAiSodProductionProvider } from "./sod-openai-production-provider.mjs";
import { createSodRunStore, safeSodFailureCode } from "./sod-run-store.mjs";
import { createSodChartStore } from "./sod-chart-store.mjs";
import { createSodProductionRunner } from "./sod-production-run.mjs";
import { fetchSodPretradeSnapshot, DEFAULT_SOD_PRETRADE_URL } from "./sod-pretrade-reader.mjs";
import { sodError } from "./sod-provider-validation.mjs";

export function sodLiveAcceptanceConfiguration(env = process.env) {
  const required = ["OPENAI_API_KEY", "EXECUTIONOS_SOD_OPENAI_MODEL", "EXECUTIONOS_SOD_RUN_STORE", "EXECUTIONOS_SOD_CHART_STORE", "EXECUTIONOS_CANDIDATE_INBOX", "EXECUTIONOS_SOD_ACCEPTANCE_CHART"];
  return { optedIn: env.EXECUTIONOS_SOD_LIVE_ACCEPTANCE === "1", missing: required.filter(key => !env[key]?.trim()) };
}
export function assertSodLiveAcceptanceResult(result) {
  if (result.candidateProposals.length) throw sodError("SOD_LIVE_ACCEPTANCE_UNEXPECTED_CANDIDATES");
}
export async function runSodLiveAcceptance(env = process.env, {
  createProvider = (options) => createOpenAiSodProductionProvider(options),
  createStore = (options) => createSodRunStore(options),
} = {}) {
  const config = sodLiveAcceptanceConfiguration(env);
  if (!config.optedIn) throw sodError("SOD_LIVE_ACCEPTANCE_OPT_IN_REQUIRED");
  if (config.missing.length) return { status: "BLOCKED", code: "SOD_LIVE_ACCEPTANCE_CONFIGURATION_MISSING", missing: config.missing };
  // Provider ownership begins as soon as construction succeeds. Keep cleanup
  // in this scope so store/chart initialization failures cannot strand its
  // dedicated transport dispatcher.
  const provider = createProvider({ env });
  let store = null;
  let primaryError = null;
  try {
    store = createStore({ rootPath: env.EXECUTIONOS_SOD_RUN_STORE });
    const charts = createSodChartStore({ rootPath: env.EXECUTIONOS_SOD_CHART_STORE });
    // Operator explicitly authorizes a non-sensitive raster via this configuration.
    // Check size before acquiring bytes; no local path crosses the provider boundary.
    const file = env.EXECUTIONOS_SOD_ACCEPTANCE_CHART;
    const size = (await fs.stat(file)).size;
    if (size < 1 || size > charts.maxBytes) throw sodError("SOD_CHART_TOO_LARGE");
    const extension = path.extname(file).toLowerCase();
    const mediaType = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extension];
    if (!mediaType) throw sodError("SOD_CHART_MEDIA_TYPE_UNSUPPORTED");
    const chart = await charts.ingest({ bytes: await fs.readFile(file), mediaType, displayName: "Acceptance chart" });
    // Establish that the local authority service exists before paying for analysis;
    // the runner will independently reacquire fresh authority after provider latency.
    const readPretrade = async () => (await fetchSodPretradeSnapshot(env.EXECUTIONOS_PRETRADE_URL || DEFAULT_SOD_PRETRADE_URL)).snapshot;
    await readPretrade();
    const runner = createSodProductionRunner({ store, provider, chartStore: charts, inboxPath: env.EXECUTIONOS_CANDIDATE_INBOX, readPretrade,
      checkpoint: async (stage, run) => {
        // A model ignoring the zero-candidate instruction must never publish from this gate.
        if (stage === "PROVIDER_RESULT_DURABLE") assertSodLiveAcceptanceResult(store.getArtifact(run.providerResultHash));
      } });
    const runId = crypto.randomUUID();
    const result = await runner.generate({ runId, sourceDate: new Date().toISOString().slice(0, 10), generationMode: "INITIAL",
      charts: [{ chartId: chart.chartId, contentRef: chart.contentRef, label: "Controlled acceptance image" }],
      marketContext: { acceptance: "Controlled provider compatibility check. Use web search for sourced VIX context. This run is for validation only; return zero candidate proposals and concise factual report sections. Do not invent market facts from this acceptance image." } });
    if (result.stage !== "NO_CANDIDATES") return { status: "FAIL", runId, stage: result.stage, code: result.failureCode || result.reason || "SOD_LIVE_ACCEPTANCE_UNEXPECTED_CANDIDATES" };
    const evidence = store.recordLiveAcceptance(runId, provider);
    return { status: "PASS", evidence, readiness: { ...provider.readiness(), liveAcceptanceValidated: store.liveAcceptanceValidated(provider) } };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try { await provider.close?.(); }
    catch (error) { if (!primaryError) throw error; }
    finally { store?.close?.(); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runSodLiveAcceptance().then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "PASS") process.exitCode = 1;
  }).catch(error => { console.error(JSON.stringify({ status: "FAIL", code: safeSodFailureCode(error) })); process.exitCode = 1; });
}
