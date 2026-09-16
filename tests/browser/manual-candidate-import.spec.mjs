import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeManualSodPackage } from "../../schwab-bridge/manual-sod-package.mjs";
import { sodArtifactContentFixture } from "../helpers/sod-artifact-content-fixture.mjs";
import { manualCandidateFixture } from "../helpers/manual-candidate-fixture.mjs";
const card = manualCandidateFixture({ targets: [181, 182] });
const json = JSON.stringify(card);
async function open(page, outcome = { status: "ACCEPTED", lifecycleState: "WAITING" }) {
  const requests = [];
  await page.route('**/api/candidates/*', route => {
    requests.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, json: { outcomes: [{ ...outcome, candidateId: card.candidateId, contractVersion: 1 }] } });
  });
  await page.goto('/tests/browser/manual-import-harness.html');
  return requests;
}
async function paste(page, raw = json) {
  await page.getByLabel('Paste candidate JSON').fill(raw);
  await page.getByRole('button', { name: 'Preview JSON', exact: true }).click();
}

test('file picker parses a JSON card, previews its fields, and submits only to canonical import', async ({ page }) => {
  const requests = await open(page);
  await page.getByLabel('Choose JSON file').setInputFiles({ name: 'card.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.getByRole('heading', { name: 'Candidate preview' })).toBeVisible();
  for (const field of ['Symbol', 'Direction', 'Setup', 'Trigger', 'Structural invalidation', 'Targets', 'Source', 'sourceDate', 'candidateId', 'contractVersion']) await expect(page.locator('dt').filter({ hasText: new RegExp('^'+field+'$') })).toBeVisible();
  await expect(page.locator('dd').filter({ hasText: 'NVDA' }).first()).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.screenshot({ path: '/tmp/sod-manual-v1/manual-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Import into PRETRADE' }).click();
  await expect(page.getByRole('status')).toContainText('ACCEPTED · WAITING');
  await expect(page.getByRole('button', { name: 'Imported ✓', exact: true })).toBeDisabled();
  expect(requests).toHaveLength(1); expect(requests[0].url).toContain('/api/candidates/import');
  expect(requests[0].body.candidates[0]).toEqual(card); expect(requests[0].body.ingressPolicy).toBe('MANUAL_AUTHORIZED');
  await page.getByRole('button', { name: 'Open PRETRADE' }).click();
  await expect.poll(() => page.evaluate(() => window.openedPretrade)).toBe(true);
});

test('pasted JSON requires preview and edits invalidate the previous preview', async ({ page }) => {
  const requests = await open(page);
  await paste(page);
  await expect(page.getByRole('button', { name: 'Import into PRETRADE' })).toBeEnabled();
  await page.getByLabel('Paste candidate JSON').fill('{');
  await expect(page.getByRole('heading', { name: 'Candidate preview' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview JSON' }).click();
  await expect(page.getByRole('alert')).toContainText('Malformed JSON');
  expect(requests).toHaveLength(0);
});

for (const [status, message] of [['DUPLICATE', 'Already imported'], ['CONFLICT', 'same version has different content'], ['ACTION_REQUIRED', 'Supersession review required'], ['REJECTED', 'Invalid candidate'], ['STALE', 'Older version']]) {
  test(`canonical ${status} is understandable and never authorizes replacement`, async ({ page }) => {
    const requests = await open(page, { status }); await paste(page);
    await page.getByRole('button', { name: 'Import into PRETRADE' }).click();
    await expect(page.getByRole('status')).toContainText(message);
    const button = page.getByRole('button', { name: status === 'DUPLICATE' ? 'Already imported' : 'Not imported — review result', exact: true });
    await expect(button).toBeDisabled();
    await button.evaluate(button => { button.click(); button.click(); });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).not.toContain('authorize');
  });
}

test('prohibited authority and integrity responses are surfaced without leaking server paths', async ({ page }) => {
  await open(page, { status: 'REJECTED', reasons: ['armAuthorized is system-owned authority and may not be supplied by a candidate proposal'] });
  await paste(page, JSON.stringify({ ...card, armAuthorized: false }));
  await page.getByRole('button', { name: 'Import into PRETRADE' }).click();
  await expect(page.getByRole('status')).toContainText('armAuthorized is system-owned authority');
  await expect(page.getByRole('button', { name: 'Not imported — review result', exact: true })).toBeDisabled();
  await page.unroute('**/api/candidates/*');
  await page.route('**/api/candidates/import', route => route.fulfill({ status: 500, json: { code: 'CANDIDATE_CONTRACT_INTEGRITY_ERROR', error: '/private/sensitive/state.json' } }));
  await paste(page);
  await page.getByRole('button', { name: 'Import into PRETRADE' }).click();
  await expect(page.getByRole('alert')).toContainText('Stored candidate integrity check failed');
  await expect(page.getByRole('button', { name: 'Import into PRETRADE', exact: true })).toBeEnabled();
  await expect(page.locator('body')).not.toContainText('/private/sensitive');
});

test('drag/drop accepts JSON and refuses executable or oversized files before parsing', async ({ page }) => {
  await open(page);
  const data = await page.evaluateHandle(raw => { const dt = new DataTransfer(); dt.items.add(new File([raw], 'drop.json', { type: 'application/json' })); return dt; }, json);
  await page.getByRole('region', { name: 'Manual candidate import' }).locator('textarea').dispatchEvent('drop', { dataTransfer: data });
  await expect(page.getByRole('heading', { name: 'Candidate preview' })).toBeVisible();
  await page.getByLabel('Choose JSON file').setInputFiles({ name: 'card.mjs', mimeType: 'text/javascript', buffer: Buffer.from('export default {}') });
  await expect(page.getByRole('alert')).toContainText('Choose a .json file');
  await page.getByLabel('Choose JSON file').setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.alloc(768*1024+1, 32) });
  await expect(page.getByRole('alert')).toContainText('768 KiB');
});

test('embedded content renders as text; duplicate keys fail locally; automated SOD stays available', async ({ page }) => {
  const requests = await open(page);
  await paste(page, JSON.stringify({ ...card, setup: '<img src=x onerror="window.executed=true">' }));
  await expect(page.locator('dd').filter({ hasText: '<img src=x' })).toBeVisible();
  expect(await page.evaluate(() => window.executed)).toBeUndefined();
  await paste(page, '{"candidateId":"a","candidateId":"b"}');
  await expect(page.getByRole('alert')).toContainText('duplicate object key');
  expect(requests).toHaveLength(0);
  await page.getByLabel('SOD source date').fill('2026-09-11');
  await page.getByRole('button', { name: 'GENERATE SOD', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.sodGenerated)).toBe(true);
});


test('existing standalone manual envelope is posted intact through the narrow adapter', async ({ page }) => {
  const requests = await open(page);
  const { source, sourceDate, generatedAt, contractVersion, schemaVersion, ...proposal } = card;
  const envelope = { ingestionSchemaVersion: 1, source: "SOD_A_PLUS_TRADES", sourceDate, bundleId: "original-manual-card", submission: { submissionId: "original-submission", submissionType: "MANUAL_STANDALONE_TRADE_CARD", preparedAt: generatedAt }, candidates: [proposal] };
  await paste(page, JSON.stringify(envelope));
  await expect(page.locator('dd').filter({ hasText: 'Resolved by existing manual lineage' })).toBeVisible();
  await page.getByRole('button', { name: 'Import into PRETRADE' }).click();
  await expect(page.getByRole('status')).toContainText('ACCEPTED');
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain('/api/candidates/manual-import');
  expect(requests[0].body).toEqual(envelope);
});

test('manual import works with SOD offline and incomplete responses cannot confirm admission', async ({ page }) => {
  const requests = await open(page);
  await page.goto('/tests/browser/manual-import-harness.html?sodOffline=1');
  await expect(page.getByRole('button', { name: 'GENERATE SOD', exact: true })).toBeDisabled();
  await paste(page);
  await page.getByRole('button', { name: 'Import into PRETRADE' }).click();
  await expect(page.getByRole('status')).toContainText('ACCEPTED');
  expect(requests).toHaveLength(1);
  await page.unroute('**/api/candidates/*');
  await page.route('**/api/candidates/import', route => route.fulfill({ status: 200, json: {} }));
  await page.getByRole('button', { name: 'Preview JSON', exact: true }).click();
  await page.getByRole('button', { name: 'Import into PRETRADE' }).click();
  await expect(page.getByRole('alert')).toContainText('MANUAL_IMPORT_INVALID_RESULT');
  await expect(page.getByRole('button', { name: 'Import into PRETRADE', exact: true })).toBeEnabled();
  await expect(page.getByRole('status')).toHaveCount(0);
});


test('generated manual SOD individual file previews and imports intact with SOD provenance', async ({ page }) => {
  const input = JSON.parse(fs.readFileSync(new URL('../../fixtures/v24-sod-candidates.example.json', import.meta.url), 'utf8'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "manual-sod-import-browser-"));
  let individual;
  try {
    const { candidates, ...bundleMetadata } = input;
    const result = await writeManualSodPackage({ artifactContent: sodArtifactContentFixture(), candidateProposals: candidates, bundleMetadata }, path.join(directory, "package"));
    expect(result.candidateDelivery.status).toBe("DELIVERED");
    individual = JSON.parse(fs.readFileSync(result.candidateDelivery.files[0], "utf8"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  const requests = await open(page);
  await page.getByLabel('Choose JSON file').setInputFiles({ name: 'manual-sod-candidate.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(individual)) });
  await expect(page.getByRole('heading', { name: 'Candidate preview' })).toBeVisible();
  await expect(page.locator('dd').filter({ hasText: 'SOD_A_PLUS_TRADES' }).first()).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Import into PRETRADE' }).click();
  await expect(page.getByRole('status')).toContainText('ACCEPTED · WAITING');
  await expect(page.getByRole('button', { name: 'Imported ✓', exact: true })).toBeDisabled();
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain('/api/candidates/import');
  expect(requests[0].body).toEqual(individual);
  expect(requests[0].body.candidates[0]).toEqual(input.candidates[0]);
  expect(requests[0].body.ingressPolicy).toBe('MANUAL_AUTHORIZED');
});


test('import is visibly disabled in flight and repeated clicks send only one request', async ({ page }) => {
  await open(page);
  await page.unroute('**/api/candidates/*');
  const requests = [];
  let release;
  const responseReady = new Promise(resolve => { release = resolve; });
  await page.route('**/api/candidates/import', async route => {
    requests.push(route.request().postDataJSON());
    await responseReady;
    await route.fulfill({ status: 200, json: { outcomes: [{ status: 'ACCEPTED', lifecycleState: 'WAITING', candidateId: card.candidateId, contractVersion: 1 }] } });
  });
  await paste(page);
  const button = page.getByRole('button', { name: 'Import into PRETRADE', exact: true });
  await expect(button).toBeEnabled();
  try {
    // Same-turn clicks exercise the synchronous submission guard as well as the disabled UI.
    await button.evaluate(button => { button.click(); button.click(); button.click(); });
    const importing = page.getByRole('button', { name: 'Importing…', exact: true });
    await expect(importing).toBeDisabled();
    await expect(page.getByLabel('Paste candidate JSON')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Preview JSON', exact: true })).toBeDisabled();
    await importing.evaluate(button => { button.click(); button.click(); });
    await expect.poll(() => requests.length).toBe(1);
  } finally {
    release();
  }
  const imported = page.getByRole('button', { name: 'Imported ✓', exact: true });
  await expect(imported).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('ACCEPTED · WAITING');
  await imported.evaluate(button => { button.click(); button.click(); });
  expect(requests).toHaveLength(1);
});

for (const reset of ['edit/paste', 'file picker', 'drop', 're-preview']) {
  test(`${reset} resets terminal import state and allows a new preview to import`, async ({ page }) => {
    const requests = await open(page);
    await paste(page);
    await page.getByRole('button', { name: 'Import into PRETRADE', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Imported ✓', exact: true })).toBeDisabled();
    const nextCard = { ...card, candidateId: `${card.candidateId}-next` };
    const nextJson = JSON.stringify(nextCard);
    if (reset === 'edit/paste') {
      await page.getByLabel('Paste candidate JSON').fill('{');
      await expect(page.getByRole('heading', { name: 'Candidate preview' })).toHaveCount(0);
      await expect(page.getByRole('status')).toHaveCount(0);
      await page.getByRole('button', { name: 'Preview JSON', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Malformed JSON');
      await paste(page, nextJson);
    } else if (reset === 'file picker') {
      await page.getByLabel('Choose JSON file').setInputFiles({ name: 'next.json', mimeType: 'application/json', buffer: Buffer.from(nextJson) });
    } else if (reset === 'drop') {
      const data = await page.evaluateHandle(raw => { const dt = new DataTransfer(); dt.items.add(new File([raw], 'next.json', { type: 'application/json' })); return dt; }, nextJson);
      await page.getByLabel('Paste candidate JSON').dispatchEvent('drop', { dataTransfer: data });
      await data.dispose();
    } else {
      await page.getByRole('button', { name: 'Preview JSON', exact: true }).click();
    }
    await expect(page.getByRole('status')).toHaveCount(0);
    const button = page.getByRole('button', { name: 'Import into PRETRADE', exact: true });
    await expect(button).toBeEnabled();
    expect(requests).toHaveLength(1);
    await button.click();
    await expect(page.getByRole('button', { name: 'Imported ✓', exact: true })).toBeDisabled();
    expect(requests).toHaveLength(2);
    expect(requests[1].body.candidates[0]).toEqual(reset === 're-preview' ? card : nextCard);
  });
}

for (const failure of ['network', 'server', 'incomplete result']) {
  test(`${failure} failure restores the import button and allows retry without another preview`, async ({ page }) => {
    await open(page);
    await page.unroute('**/api/candidates/*');
    const requests = [];
    await page.route('**/api/candidates/import', route => {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) {
        if (failure === 'network') return route.abort('failed');
        if (failure === 'server') return route.fulfill({ status: 503, json: { code: 'PRETRADE_UNAVAILABLE' } });
        return route.fulfill({ status: 200, json: {} });
      }
      return route.fulfill({ status: 200, json: { outcomes: [{ status: 'ACCEPTED', lifecycleState: 'WAITING', candidateId: card.candidateId, contractVersion: 1 }] } });
    });
    await paste(page);
    const button = page.getByRole('button', { name: 'Import into PRETRADE', exact: true });
    await button.click();
    await expect(page.getByRole('alert')).toContainText('Import was not confirmed');
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(button).toBeEnabled();
    expect(requests).toHaveLength(1);
    await button.click();
    await expect(page.getByRole('button', { name: 'Imported ✓', exact: true })).toBeDisabled();
    await expect(page.getByRole('status')).toContainText('ACCEPTED · WAITING');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });
}
