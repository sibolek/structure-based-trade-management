import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { harness, create } from "./helpers/pretrade-preview-fixture.mjs";

const beforeRename = new Set(["BEFORE_TEMP_WRITE", "AFTER_FILE_FLUSH", "BEFORE_RENAME"]);
const points = [...beforeRename, "AFTER_RENAME", "DURING_DIRECTORY_FLUSH", "AFTER_DIRECTORY_FLUSH", "AFTER_DURABLE_COMMIT_BEFORE_RESPONSE"];

test("isolated process-death matrix recovers exact acceptance outcomes across filesystem boundaries", async t => {
  for (const phase of ["reservation", "terminal"]) {
    for (const point of points) {
      if (phase === "reservation" && point === "AFTER_DURABLE_COMMIT_BEFORE_RESPONSE") continue;
      await t.test(`${phase}: ${point}`, () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "preview-fault-qualification-"));
        t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
        const filePath = path.join(directory, "state.json");
        const child = spawnSync(process.execPath, [new URL("./helpers/pretrade-preview-fault-worker.mjs", import.meta.url).pathname, filePath, point, phase], { encoding: "utf8", timeout: 15_000 });
        assert.equal(child.signal, "SIGKILL", child.stderr);
        const marker = JSON.parse(child.stdout.trim());
        assert.equal(marker.point, point);
        const blocked = new PreTradeStore({ filePath });
        assert.throws(() => blocked.acquireWriterLock(), { code: "PRETRADE_WRITER_LOCKED" });
        // Model supervised stale-lock recovery ONLY in this newly owned temp dir:
        // spawnSync has reaped this exact writer; production never auto-reclaims.
        assert.equal(JSON.parse(fs.readFileSync(`${filePath}.writer.lock`, "utf8")).pid, child.pid);
        fs.unlinkSync(`${filePath}.writer.lock`);
        const h = harness({ filePath });
        const prior = h.store.snapshot();
        h.authority.recoverAfterRestart();
        const recovered = h.store.snapshot();
        const preview = recovered.pretradePreviews[0];
        const receipt = recovered.pretradePreviewReceipts[0];
        const admitted = phase === "terminal" && !beforeRename.has(point);
        assert.equal(recovered.candidates.length, admitted ? 1 : 0);
        assert.equal(recovered.importLog.length, admitted ? 1 : 0);
        if (phase === "reservation" && beforeRename.has(point)) {
          assert.equal(receipt, undefined);
          assert.equal(preview.revalidationRequired, true);
          assert.equal(preview.state, "PREVIEW_READY");
        } else {
          assert.equal(receipt.result, admitted ? "ADMITTED" : "NOT_ADMITTED");
          if (!admitted) assert.equal(receipt.reason, "INTERRUPTED");
          else {
            assert.deepEqual(receipt, prior.pretradePreviewReceipts[0]);
            assert.equal(recovered.candidates[0].lifecycleState, "WAITING");
            assert.equal(recovered.candidates[0].arm, null);
            assert.equal(recovered.candidates[0].permission ?? null, null);
            assert.equal(recovered.candidates[0].lifecycleJournal.events.length, 1);
          }
        }
        const receiptBeforeSecondRecovery = structuredClone(recovered.pretradePreviewReceipts);
        h.authority.recoverAfterRestart();
        assert.deepEqual(h.store.snapshot().pretradePreviewReceipts, receiptBeforeSecondRecovery);
        assert.equal(h.store.snapshot().candidates.length, admitted ? 1 : 0);
        assert.equal(recovered.dssEvaluations.length, 0);
        h.store.close();
      });
    }
  }
});

test("directory fsync EIO after rename fences every writer and recovers the installed terminal image", async () => {
  let fail = false;
  const h = harness({ failpoint(point) {
    if (fail && point === "DURING_DIRECTORY_FLUSH") throw Object.assign(new Error("injected directory fsync EIO"), { code: "EIO" });
  }, evidenceProvider: async () => { fail = true; return {}; } });
  const preview = create(h.authority);
  await assert.rejects(h.authority.accept(preview), { code: "OUTCOME_UNKNOWN" });
  assert.equal(h.store.fenced, true);
  assert.throws(() => h.store.save(), { code: "PRETRADE_WRITER_FENCED" });
  h.store.close();
  const recovered = harness({ filePath: h.filePath });
  recovered.authority.recoverAfterRestart();
  assert.equal(recovered.store.snapshot().pretradePreviewReceipts[0].result, "ADMITTED");
  recovered.store.close();
});
