import { test, expect } from "@playwright/test";

const ROUTER_LOCK_NAME = "executionos-v24-runtime-router";
const HARNESS = "/tests/browser/v24-router-harness.html";

async function routerState(page) {
  return page.evaluate(() => window.__V24_ROUTER_STATE__ || null);
}

async function routerLocks(page) {
  return page.evaluate(async (lockName) => {
    const snapshot = await navigator.locks.query();
    return {
      held: snapshot.held.filter((item) => item.name === lockName),
      pending: snapshot.pending.filter((item) => item.name === lockName),
    };
  }, ROUTER_LOCK_NAME);
}

async function waitForOneLeader(pages) {
  await expect.poll(async () => {
    const states = await Promise.all(pages.map(routerState));
    return states.filter((state) => state?.leader === true).length;
  }).toBe(1);

  return Promise.all(pages.map(routerState));
}

async function openCleanHarness(page) {
  await page.goto(HARNESS);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(async () => Boolean((await routerState(page))?.receiverId)).toBe(true);
}

test("Decision 22J real Chromium Web Lock allows exactly one router leader and one passive tab", async ({ page, context }) => {
  await openCleanHarness(page);
  const second = await context.newPage();
  await second.goto(HARNESS);

  const states = await waitForOneLeader([page, second]);
  const leaders = states.filter((state) => state?.leader);
  const passive = states.filter((state) => !state?.leader);

  expect(leaders).toHaveLength(1);
  expect(passive).toHaveLength(1);
  expect(passive[0].status).toBe("WAITING_FOR_ROUTER_LOCK");

  const locks = await routerLocks(page);
  expect(locks.held).toHaveLength(1);
  expect(locks.held[0].mode).toBe("exclusive");
  expect(locks.pending).toHaveLength(1);

  expect(states[0].receiverId).toBeTruthy();
  expect(states[1].receiverId).toBe(states[0].receiverId);
  expect(states[0].brokerWriteAuthority).toBe(false);
  expect(states[1].brokerWriteAuthority).toBe(false);
});

test("Decision 22J passive tab takes leadership after leader closes without refresh", async ({ page, context }) => {
  await openCleanHarness(page);
  const second = await context.newPage();
  await second.goto(HARNESS);

  const states = await waitForOneLeader([page, second]);
  const leaderIndex = states.findIndex((state) => state?.leader === true);
  const leaderPage = leaderIndex === 0 ? page : second;
  const passivePage = leaderIndex === 0 ? second : page;
  const receiverId = states[leaderIndex].receiverId;

  await leaderPage.close();

  await expect.poll(async () => (await routerState(passivePage))?.leader).toBe(true);
  await expect.poll(async () => {
    const status = (await routerState(passivePage))?.status;
    return ["RUNNING", "WAITING_FOR_PRETRADE"].includes(status);
  }).toBe(true);

  const takeover = await routerState(passivePage);
  expect(takeover.receiverId).toBe(receiverId);
  expect(takeover.brokerWriteAuthority).toBe(false);

  const locks = await routerLocks(passivePage);
  expect(locks.held).toHaveLength(1);
  expect(locks.pending).toHaveLength(0);
});

test("Decision 22J reload creates a fresh router epoch and reacquires one exclusive lock", async ({ page }) => {
  await openCleanHarness(page);

  await expect.poll(async () => (await routerState(page))?.leader).toBe(true);
  const before = await routerState(page);
  const receiverId = before.receiverId;

  let locks = await routerLocks(page);
  expect(locks.held).toHaveLength(1);
  expect(locks.pending).toHaveLength(0);

  await page.reload();

  await expect.poll(async () => (await routerState(page))?.leader).toBe(true);
  const after = await routerState(page);

  expect(after.receiverId).toBe(receiverId);
  expect(after.brokerWriteAuthority).toBe(false);

  locks = await routerLocks(page);
  expect(locks.held).toHaveLength(1);
  expect(locks.pending).toHaveLength(0);
});

test("Decision 22J reload with a passive peer never produces overlapping router leaders", async ({ page, context }) => {
  await openCleanHarness(page);
  const second = await context.newPage();
  await second.goto(HARNESS);

  let states = await waitForOneLeader([page, second]);
  const leaderIndex = states.findIndex((state) => state?.leader === true);
  const leaderPage = leaderIndex === 0 ? page : second;

  await leaderPage.reload();

  states = await waitForOneLeader([page, second]);

  expect(states.filter((state) => state?.leader === true)).toHaveLength(1);
  expect(states.filter((state) => state?.leader !== true)).toHaveLength(1);

  const locks = await routerLocks(page);
  expect(locks.held).toHaveLength(1);
  expect(locks.pending).toHaveLength(1);

  expect(states[0].brokerWriteAuthority).toBe(false);
  expect(states[1].brokerWriteAuthority).toBe(false);
});
