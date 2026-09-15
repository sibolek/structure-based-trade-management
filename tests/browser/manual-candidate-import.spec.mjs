import { test, expect } from "@playwright/test";
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

for (const [status, message] of [['DUPLICATE', 'Already imported'], ['CONFLICT', 'same version has different content'], ['ACTION_REQUIRED', 'Supersession review required']]) {
  test(`canonical ${status} is understandable and never authorizes replacement`, async ({ page }) => {
    const requests = await open(page, { status }); await paste(page);
    await page.getByRole('button', { name: 'Import into PRETRADE' }).click();
    await expect(page.getByRole('status')).toContainText(message);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).not.toContain('authorize');
  });
}

test('prohibited authority and integrity responses are surfaced without leaking server paths', async ({ page }) => {
  await open(page, { status: 'REJECTED', reasons: ['armAuthorized is system-owned authority and may not be supplied by a candidate proposal'] });
  await paste(page, JSON.stringify({ ...card, armAuthorized: false }));
  await page.getByRole('button', { name: 'Import into PRETRADE' }).click();
  await expect(page.getByRole('status')).toContainText('armAuthorized is system-owned authority');
  await page.unroute('**/api/candidates/*');
  await page.route('**/api/candidates/import', route => route.fulfill({ status: 500, json: { code: 'CANDIDATE_CONTRACT_INTEGRITY_ERROR', error: '/private/sensitive/state.json' } }));
  await paste(page);
  await page.getByRole('button', { name: 'Import into PRETRADE' }).click();
  await expect(page.getByRole('alert')).toContainText('Stored candidate integrity check failed');
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
  await page.getByRole('button', { name: 'Import into PRETRADE' }).click();
  await expect(page.getByRole('alert')).toContainText('MANUAL_IMPORT_INVALID_RESULT');
  await expect(page.getByRole('status')).toHaveCount(0);
});
