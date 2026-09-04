import { test, expect } from "@playwright/test";

const HARNESS = "/tests/browser/v24-recovery-harness.html";
const T1 = "2026-09-02T18:00:03.000Z";
const T2 = "2026-09-02T18:00:04.000Z";
const CUTOFF = "2026-09-02T18:00:04.000Z";

async function waitForApi(page) {
  await expect.poll(async () => {
    return page.evaluate(() => Boolean(window.__V24_RECOVERY_TEST__));
  }).toBe(true);
}

async function openCleanRecovery(page) {
  await page.goto(HARNESS);
  await waitForApi(page);
  await page.evaluate(() => window.__V24_RECOVERY_TEST__.clear());
}

async function invoke(page, method, args) {
  return page.evaluate(
    async ({ method, args }) => window.__V24_RECOVERY_TEST__[method](args),
    { method, args },
  );
}

async function state(page) {
  return page.evaluate(() => window.__V24_RECOVERY_TEST__.state());
}

function stage(result, name) {
  return result.result.results.find((item) => item.stage === name);
}

async function establishListening(page, { ackFails = false } = {}) {
  const prepared = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:02.500Z",
    now: T1,
  });

  expect(stage(prepared, "ACTIVATION").status).toBe("WAITING_FOR_BROKER_PROOF");

  const listening = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:03.500Z",
    now: "2026-09-02T18:00:03.600Z",
    ackFails,
  });

  return listening;
}

test("Decision 22J PREPARED restart abandons transient T1 and safely chooses fresh T2", async ({ page }) => {
  await openCleanRecovery(page);

  const firstEpoch = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:02.500Z",
    now: T1,
  });

  expect(stage(firstEpoch, "ACTIVATION").status).toBe("WAITING_FOR_BROKER_PROOF");
  expect(stage(firstEpoch, "ACTIVATION").proposedExecutionListeningAt).toBe(T1);
  expect(firstEpoch.ownership.installation.status).toBe("PREPARED");
  expect(firstEpoch.ownership.installation.executionListeningAt).toBeNull();

  await page.reload();
  await waitForApi(page);

  const restarted = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:03.500Z",
    now: T2,
  });

  expect(stage(restarted, "ACTIVATION").status).toBe("WAITING_FOR_BROKER_PROOF");
  expect(stage(restarted, "ACTIVATION").proposedExecutionListeningAt).toBe(T2);
  expect(stage(restarted, "ACTIVATION").proposedExecutionListeningAt).not.toBe(T1);

  const delivered = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:04.500Z",
    now: "2026-09-02T18:00:04.600Z",
  });

  expect(stage(delivered, "ACTIVATION").status).toBe("DELIVERED");
  expect(delivered.ownership.installation.status).toBe("LISTENING");
  expect(delivered.ownership.installation.executionListeningAt).toBe(T2);
});

test("Decision 22J durable LISTENING survives reload and remains the local first-fill authority", async ({ page }) => {
  await openCleanRecovery(page);

  const listening = await establishListening(page);
  expect(stage(listening, "ACTIVATION").status).toBe("DELIVERED");
  expect(listening.ownership.installation.status).toBe("LISTENING");
  expect(listening.ownership.installation.executionListeningAt).toBe(T1);

  await page.reload();
  await waitForApi(page);

  const recovered = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:05.000Z",
    now: "2026-09-02T18:00:05.100Z",
    emptyDiscovery: true,
  });

  expect(stage(recovered, "FIRST_FILL").status).toBe("WAITING");
  expect(recovered.ownership.installation.status).toBe("LISTENING");
  expect(recovered.ownership.installation.executionListeningAt).toBe(T1);
  expect(recovered.ownedSymbols).toContain("NVDA");
});

test("Decision 22J ACK-pending restart retries the original immutable LISTENING boundary", async ({ page }) => {
  await openCleanRecovery(page);

  const pending = await establishListening(page, { ackFails: true });

  expect(stage(pending, "ACTIVATION").status).toBe("LISTENING_ACK_PENDING");
  expect(pending.ownership.installation.status).toBe("LISTENING");
  expect(pending.ownership.installation.executionListeningAt).toBe(T1);

  await page.reload();
  await waitForApi(page);

  const recovered = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:10.000Z",
    now: "2026-09-02T18:00:09.000Z",
  });

  expect(stage(recovered, "ACTIVATION").status).toBe("DELIVERED");

  const ack = recovered.transportCalls.find((call) => call[0] === "ack");
  expect(ack).toEqual(["ack", "handoff-browser-recovery", "receiver-A", T1]);

  expect(recovered.ownership.installation.executionListeningAt).toBe(T1);
});

test("Decision 22J REQUESTED retirement catches up and resolves without another refresh", async ({ page }) => {
  await openCleanRecovery(page);

  await establishListening(page);

  const requested = await invoke(page, "requestRetirement", CUTOFF);
  expect(requested.retirement.status).toBe("REQUESTED");
  expect(requested.retirement.cutoffAt).toBe(CUTOFF);

  await page.reload();
  await waitForApi(page);

  const behind = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:03.750Z",
    now: "2026-09-02T18:00:05.000Z",
    emptyDiscovery: true,
  });

  expect(stage(behind, "RETIREMENT").status).toBe("REQUESTED");
  expect(behind.ownership.retirement.status).toBe("REQUESTED");
  expect(behind.ownedSymbols).toContain("NVDA");

  // No reload here: advancing broker proof alone must recover the retirement.
  const caughtUp = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:04.500Z",
    now: "2026-09-02T18:00:05.500Z",
    emptyDiscovery: true,
  });

  expect(stage(caughtUp, "RETIREMENT").status).toBe("RETIRED");
  expect(caughtUp.ownership.retirement.status).toBe("RETIRED");
  expect(caughtUp.ownedSymbols).not.toContain("NVDA");
});

test("Decision 22J SUPERSEDED_BY_PRIOR_FILL resumes after reload and promotes to LIVE", async ({ page }) => {
  await openCleanRecovery(page);

  await establishListening(page);
  await invoke(page, "requestRetirement", CUTOFF);

  const superseded = await invoke(page, "resolveRetirement", {
    currentThrough: "2026-09-02T18:00:05.000Z",
    events: ["ENTRY"],
    finalizedAt: "2026-09-02T18:00:05.100Z",
  });

  expect(superseded.retirement.status).toBe("SUPERSEDED_BY_PRIOR_FILL");
  expect(superseded.ownership.lifecycle).toBeNull();
  expect(superseded.ownedSymbols).toContain("NVDA");

  await page.reload();
  await waitForApi(page);

  const recovered = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:05.000Z",
    events: ["ENTRY"],
    now: "2026-09-02T18:00:05.200Z",
    emptyDiscovery: true,
  });

  expect(stage(recovered, "FIRST_FILL").status).toBe("PROMOTED_LIVE");
  expect(recovered.ownership.lifecycle.status).toBe("LIVE");
  expect(recovered.ownership.liveTrade.phase).toBe("LIVE");
  expect(recovered.ownedSymbols).toContain("NVDA");
});

test("Decision 22J LIVE lifecycle resumes its durable cursor after reload", async ({ page }) => {
  await openCleanRecovery(page);

  await establishListening(page);

  const promoted = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:05.000Z",
    events: ["ENTRY"],
    now: "2026-09-02T18:00:05.100Z",
    emptyDiscovery: true,
  });

  expect(stage(promoted, "FIRST_FILL").status).toBe("PROMOTED_LIVE");
  expect(promoted.ownership.lifecycle.status).toBe("LIVE");
  expect(promoted.ownership.lifecycle.currentQuantity).toBe(5);

  await page.reload();
  await waitForApi(page);

  const recovered = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:06.000Z",
    events: ["ENTRY", "PARTIAL"],
    now: "2026-09-02T18:00:06.100Z",
    emptyDiscovery: true,
  });

  expect(stage(recovered, "LIFECYCLE").status).toBe("LIVE");
  expect(recovered.ownership.lifecycle.status).toBe("LIVE");
  expect(recovered.ownership.lifecycle.currentQuantity).toBe(3);
  expect(recovered.ownership.lifecycle.lastProcessedSequence).toBe(2);
  expect(recovered.ownership.liveTrade.broker.currentQuantity).toBe(3);
});

test("Decision 22J EXIT-before-History remains owned across reload until History exists", async ({ page }) => {
  await openCleanRecovery(page);

  await establishListening(page);

  const exited = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:06.000Z",
    events: ["ENTRY", "FLAT"],
    now: "2026-09-02T18:00:06.100Z",
    emptyDiscovery: true,
  });

  expect(exited.ownership.lifecycle.status).toBe("EXIT");
  expect(exited.ownership.liveTrade.phase).toBe("EXIT");
  expect(exited.ownership.history).toBeNull();
  expect(exited.ownedSymbols).toContain("NVDA");

  await page.reload();
  await waitForApi(page);

  const recovered = await invoke(page, "runCycle", {
    currentThrough: "2026-09-02T18:00:06.500Z",
    events: ["ENTRY", "FLAT"],
    now: "2026-09-02T18:00:06.600Z",
    emptyDiscovery: true,
  });

  expect(recovered.ownership.lifecycle.status).toBe("EXIT");
  expect(recovered.ownership.liveTrade.phase).toBe("EXIT");
  expect(recovered.ownership.history).toBeNull();
  expect(recovered.ownership.lifecycleReservesSymbol).toBe(true);
  expect(recovered.ownedSymbols).toContain("NVDA");

  const safety = await page.evaluate(() => window.__V24_RECOVERY_TEST__.safety());
  expect(safety).toEqual({
    brokerReadOnly: true,
    brokerWriteAuthority: false,
    externalBrokerWrites: 0,
  });
});
