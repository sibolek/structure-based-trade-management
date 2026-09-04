import { test, expect } from "@playwright/test";

const HARNESS = "/tests/browser/v24-router-harness.html";

async function openCleanHarness(page) {
  await page.goto(HARNESS);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect.poll(async () => {
    return page.evaluate(() => Boolean(window.__V24_STORE_TEST__));
  }).toBe(true);
}

async function durableStore(page) {
  return page.evaluate(() => window.__V24_STORE_TEST__.read());
}

async function projectedStore(page) {
  return page.evaluate(() => window.__V24_STORE_TEST__.projection());
}

test("Decision 22J real Chromium serializes simultaneous cross-tab canonical writes without lost update", async ({ page, context }) => {
  await openCleanHarness(page);

  const second = await context.newPage();
  await second.goto(HARNESS);

  await expect.poll(async () => {
    return second.evaluate(() => Boolean(window.__V24_STORE_TEST__));
  }).toBe(true);

  const before = await durableStore(page);
  expect(before.storeRevision).toBe(0);
  expect(before.candidates).toHaveLength(0);

  const [commitA, commitB] = await Promise.all([
    page.evaluate(() => window.__V24_STORE_TEST__.appendCandidate("tab-A")),
    second.evaluate(() => window.__V24_STORE_TEST__.appendCandidate("tab-B")),
  ]);

  const revisions = [commitA.storeRevision, commitB.storeRevision].sort((a, b) => a - b);
  expect(revisions).toEqual([1, 2]);

  const finalA = await durableStore(page);
  const finalB = await durableStore(second);

  expect(finalA.storeRevision).toBe(2);
  expect(finalB.storeRevision).toBe(2);

  expect(finalA.candidates.map((item) => item.id).sort()).toEqual(["tab-A", "tab-B"]);
  expect(finalB.candidates.map((item) => item.id).sort()).toEqual(["tab-A", "tab-B"]);

  const lockNameA = await page.evaluate(() => window.__V24_STORE_TEST__.writerLockName);
  const lockNameB = await second.evaluate(() => window.__V24_STORE_TEST__.writerLockName);

  expect(lockNameA).toBe("executionos-execution-board-store-writer");
  expect(lockNameB).toBe(lockNameA);
});

test("Decision 22J passive tab projection rereads canonical durable state after real storage notification", async ({ page, context }) => {
  await openCleanHarness(page);

  const second = await context.newPage();
  await second.goto(HARNESS);

  await expect.poll(async () => {
    return second.evaluate(() => Boolean(window.__V24_STORE_TEST__));
  }).toBe(true);

  const initialProjection = await projectedStore(second);
  expect(initialProjection.storeRevision).toBe(0);

  await page.evaluate(() => window.__V24_STORE_TEST__.appendCandidate("leader-write"));

  await expect.poll(async () => {
    const projection = await projectedStore(second);
    return projection?.storeRevision;
  }).toBe(1);

  const passiveProjection = await projectedStore(second);

  expect(passiveProjection.candidates).toHaveLength(1);
  expect(passiveProjection.candidates[0].id).toBe("leader-write");

  const durable = await durableStore(second);
  expect(passiveProjection).toEqual(durable);
});

test("Decision 22J cross-tab notification payload is never canonical authority", async ({ page, context }) => {
  await openCleanHarness(page);

  const second = await context.newPage();
  await second.goto(HARNESS);

  await expect.poll(async () => {
    return second.evaluate(() => Boolean(window.__V24_STORE_TEST__));
  }).toBe(true);

  await page.evaluate(() => window.__V24_STORE_TEST__.appendCandidate("canonical"));

  await expect.poll(async () => {
    const projection = await projectedStore(second);
    return projection?.storeRevision;
  }).toBe(1);

  await second.evaluate(() => {
    window.__V24_STORE_TEST__.dispatchUntrustedStorageNotification(JSON.stringify({
      storeSchemaVersion: 1,
      storeRevision: 999,
      candidates: [{ id: "MALICIOUS_EVENT_PAYLOAD" }],
    }));
  });

  const projection = await projectedStore(second);
  const durable = await durableStore(second);

  expect(projection.storeRevision).toBe(1);
  expect(projection.candidates.map((item) => item.id)).toEqual(["canonical"]);
  expect(projection).toEqual(durable);
});

test("Decision 22J canonical writer lock is a real browser-wide exclusive Web Lock", async ({ page }) => {
  await openCleanHarness(page);

  const result = await page.evaluate(async () => {
    const name = window.__V24_STORE_TEST__.writerLockName;

    let snapshotWhileHeld = null;

    await navigator.locks.request(name, { mode: "exclusive" }, async () => {
      const snapshot = await navigator.locks.query();
      snapshotWhileHeld = {
        held: snapshot.held.filter((item) => item.name === name),
        pending: snapshot.pending.filter((item) => item.name === name),
      };
    });

    return snapshotWhileHeld;
  });

  expect(result.held).toHaveLength(1);
  expect(result.held[0].name).toBe("executionos-execution-board-store-writer");
  expect(result.held[0].mode).toBe("exclusive");
  expect(result.pending).toHaveLength(0);
});
