// Only invoked by the isolated filesystem qualification test, never by runtime.
import fs from "node:fs";
import { harness, create } from "./pretrade-preview-fixture.mjs";

const [filePath, point, phase] = process.argv.slice(2);
let armed = false;
const h = harness({
  filePath,
  failpoint(name) {
    if (armed && name === point) {
      fs.writeSync(1, `${JSON.stringify({ point, phase, pid: process.pid })}\n`);
      process.kill(process.pid, "SIGKILL");
    }
  },
  evidenceProvider: async () => { if (phase === "terminal") armed = true; return {}; },
});
const preview = create(h.authority);
if (phase === "reservation") armed = true;
const receipt = await h.authority.accept(preview);
if (point === "AFTER_DURABLE_COMMIT_BEFORE_RESPONSE") {
  fs.writeSync(1, `${JSON.stringify({ point, phase, pid: process.pid, transactionId: receipt.commitTransactionId })}\n`);
  process.kill(process.pid, "SIGKILL");
}
throw new Error("requested fault point was not reached");
