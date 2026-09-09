import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCandidatePublicationPaths,
  publishCandidateBundleAtomically,
} from "../schwab-bridge/sod-candidate-publisher.mjs";
import { listPendingCandidatePublications } from "../schwab-bridge/candidate-feeder.mjs";

function bundle() {
  return {
    schemaVersion: 1,
    source: "SOD_A_PLUS_TRADES",
    sourceDate: "2026-09-09",
    generatedAt: "2026-09-09T19:00:00.000Z",
    bundleId: "sod-2026-09-09-a-plus-trades-v1",
    ingressPolicy: "AUTOMATED_UNTOUCHED_ONLY",
    candidates: [],
  };
}

test("publication paths keep temp invisible to feeder and final publication inside configured inbox", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-publish-"));
  try {
    const paths = buildCandidatePublicationPaths({
      inboxPath: inbox,
      bundle: bundle(),
      publicationId: "publish-123",
    });

    assert.equal(path.dirname(paths.tempPath), path.resolve(inbox));
    assert.equal(path.dirname(paths.finalPath), path.resolve(inbox));
    assert.match(paths.tempName, /^\./);
    assert.equal(paths.tempName.endsWith(".json"), false);
    assert.equal(paths.finalName.endsWith(".json"), true);

    await fs.writeFile(paths.tempPath, "partial");
    assert.deepEqual(await listPendingCandidatePublications(inbox), []);
  } finally {
    await fs.rm(inbox, { recursive: true, force: true });
  }
});

test("atomic publisher exposes only complete immutable JSON publication", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-publish-"));
  try {
    const input = bundle();
    const result = await publishCandidateBundleAtomically({
      inboxPath: inbox,
      bundle: input,
      idFactory: () => "publish-abc",
    });

    const pending = await listPendingCandidatePublications(inbox);
    assert.deepEqual(pending, [result.finalPath]);
    assert.deepEqual(JSON.parse(await fs.readFile(result.finalPath, "utf8")), input);
    assert.equal((await fs.readdir(inbox)).some((name) => name.endsWith(".tmp")), false);
    assert.equal(result.finalName.endsWith(".json"), true);
    assert.ok(result.byteLength > 0);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await fs.rm(inbox, { recursive: true, force: true });
  }
});

test("publisher never accepts caller-controlled final paths and fails closed on deterministic collision", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-publish-"));
  try {
    const input = bundle();
    const first = await publishCandidateBundleAtomically({
      inboxPath: inbox,
      bundle: input,
      idFactory: () => "same-id",
    });
    assert.ok(first.finalPath.startsWith(path.resolve(inbox) + path.sep));

    await assert.rejects(
      publishCandidateBundleAtomically({
        inboxPath: inbox,
        bundle: input,
        idFactory: () => "same-id",
      }),
      (error) => error.code === "SOD_PUBLICATION_DESTINATION_COLLISION",
    );

    assert.equal((await fs.readdir(inbox)).filter((name) => name.endsWith(".json")).length, 1);
  } finally {
    await fs.rm(inbox, { recursive: true, force: true });
  }
});
