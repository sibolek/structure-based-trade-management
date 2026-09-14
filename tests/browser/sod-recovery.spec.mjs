import { test, expect } from "@playwright/test";

const health = { ok: true, service: "executionos-v24-sod-orchestrator", providerLoaded: true,
  providerConfigured: true, modelConfigured: true, timeoutMs: 600000,
  pretradeAccess: "READ_ONLY_HTTP", candidatePublication: "ATOMIC_INBOX_ONLY", chartIngestion: "IMMUTABLE_OPAQUE_REF",
  lifecycleAuthority: false, armAuthority: false, executionAuthority: false, brokerWriteAuthority: false };

async function setup(page, { ambiguous = false, conflict = false } = {}) {
  const requests = [];
  let uploads = 0, current;
  // Every service request is fulfilled locally; unexpected destinations are blocked.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4174') return route.continue();
    if (url.origin !== 'http://127.0.0.1:8790') return route.abort();
    if (url.pathname === '/health') return route.fulfill({ json: health });
    if (url.pathname === '/api/sod/session') return route.fulfill({ json: { service: health.service, sessionToken: 'offline-test-session' } });
    if (url.pathname === '/api/sod/charts') {
      uploads++;
      return route.fulfill({ status: 201, json: { chart: { chartId: `chart-${uploads}`, contentRef: `sod-chart:${uploads}`, displayName: `Session chart ${uploads}`, mediaType: 'image/png', byteLength: 4, sha256: 'a'.repeat(64) } } });
    }
    if (url.pathname === '/api/sod/generate') {
      const request = route.request().postDataJSON(); requests.push(request);
      if (conflict) return route.fulfill({ status: 409, json: { error: 'SOD_RUN_ACTIVE_CONFLICT', activeRun: {
        runId: 'existing-run', sourceDate: request.sourceDate, stage: 'RECOVERY_REQUIRED', reason: 'PROVIDER_OUTCOME_AMBIGUOUS' } } });
      current = { runId: request.runId, sourceDate: request.sourceDate,
        ...(ambiguous ? { stage: 'RECOVERY_REQUIRED', reason: 'PROVIDER_OUTCOME_AMBIGUOUS', error: 'SOD_RUN_PROVIDER_OUTCOME_AMBIGUOUS',
          providerDiagnostics: { errorCode: 'SOD_OPENAI_TIMEOUT', elapsedMs: 600001, phase: 'BODY_READING' } }
          : { stage: 'NO_CANDIDATES', lineage: [] }) };
      return route.fulfill({ status: ambiguous ? 409 : 200, json: current });
    }
    if (url.pathname.startsWith('/api/sod/runs/') && route.request().method() === 'GET') {
      return route.fulfill({ status: ambiguous ? 409 : 200, json: current });
    }
    throw new Error(`Unexpected service action: ${route.request().method()} ${url.pathname}`);
  });
  await page.goto('/tests/browser/sod-recovery-harness.html');
  await expect(page.getByText('SOD SERVICE ONLINE')).toBeVisible();
  return requests;
}
async function upload(page) {
  await page.locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]').setInputFiles(
    Array.from({ length: 7 }, (_, i) => ({ name: `chart-${i}.png`, mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) })));
  await expect(page.getByText('Session chart 7', { exact: true })).toBeVisible();
}
const generate = page => page.getByRole('button', { name: 'GENERATE SOD', exact: true });

test('date is explicit and preserved across seven uploads, midnight, workspace switching and request serialization', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-14T03:36:00Z') });
  const requests = await setup(page);
  const date = page.getByLabel('SOD source date');
  await expect(date).toHaveValue(''); await upload(page);
  await expect(generate(page)).toBeDisabled();
  await date.fill('2026-09-11');
  await page.getByRole('button', { name: 'Toggle workspace' }).click();
  await page.getByRole('button', { name: 'Toggle workspace' }).click();
  await page.clock.setSystemTime(new Date('2026-09-15T08:00:00Z'));
  await expect(date).toHaveValue('2026-09-11');
  await generate(page).click();
  await expect(page.getByRole('heading', { name: '2026-09-11 · NO_CANDIDATES' })).toBeVisible();
  expect(requests).toHaveLength(1); expect(requests[0].sourceDate).toBe('2026-09-11'); expect(requests[0].charts).toHaveLength(7);
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(0);
  await expect(page.getByText('0', { exact: true })).toBeVisible();
  await page.reload();
  await expect(date).toHaveValue('');
  await expect(page.getByText('Recorded run source date: 2026-09-11')).toBeVisible();
  await date.fill('2026-09-12');
  await page.getByRole('button', { name: 'Resume saved run' }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
});

test('ambiguous result is unavailable and blocks only its actual source date', async ({ page }) => {
  const requests = await setup(page, { ambiguous: true }); await upload(page);
  const date = page.getByLabel('SOD source date'); await date.fill('2026-09-13'); await generate(page).click();
  await expect(page.getByText('Candidates unavailable — provider outcome ambiguous')).toBeVisible();
  await expect(page.getByText('0', { exact: true })).toHaveCount(0);
  await expect(generate(page)).toBeDisabled(); await expect(page.getByRole('button', { name: 'REFRESH SOD' })).toBeDisabled();
  await expect(page.getByText('Recorded run source date: 2026-09-13')).toBeVisible();
  await expect(page.getByText(/Provider diagnostic: SOD_OPENAI_TIMEOUT/)).toBeVisible();
  await date.fill('2026-09-11'); await expect(generate(page)).toBeEnabled();
  await expect(page.getByText('Recorded run source date: 2026-09-13')).toBeVisible();
  await date.fill('2026-09-13'); await expect(generate(page)).toBeDisabled();
  expect(requests).toHaveLength(1);
});

test('a same-date conflict returned by the server disables another generation', async ({ page }) => {
  const requests = await setup(page, { conflict: true }); await upload(page);
  await page.getByLabel('SOD source date').fill('2026-09-13'); await generate(page).click();
  await expect(page.getByText('Resolve the existing run for 2026-09-13 before starting another.')).toBeVisible();
  await expect(generate(page)).toBeDisabled();
  expect(requests).toHaveLength(1);
});
