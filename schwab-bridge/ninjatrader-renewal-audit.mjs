import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const STAGES = ['STARTED', 'SUCCEEDED', 'FAILED'];
const TRIGGERS = ['scheduled', 'forced', 'server_401'];
const OAUTH_ERRORS = ['invalid_token', 'invalid_grant', 'access_denied', 'invalid_client', 'unauthorized_client', 'invalid_scope', 'invalid_target', 'unsupported_grant_type', 'invalid_request', 'server_error', 'temporarily_unavailable'];
const HINTS = ['REUSED_OR_SUPERSEDED', 'REVOKED', 'EXPIRED', 'AUDIENCE_OR_RESOURCE', 'CLIENT', 'SIGNATURE', 'UNKNOWN_GRANT', 'UNSPECIFIED'];
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export function renewalExpiryClaim(token) {
  if (typeof token !== 'string' || token.length > 32768 || token.split('.').length !== 3) return null;
  try { const { exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); return Number.isFinite(exp) && exp > 0 && exp < 1e11 ? new Date(exp * 1000).toISOString() : null; } catch { return null; }
}
export function renewalServerHint(description) {
  if (typeof description !== 'string' || description.length > 2048) return 'UNSPECIFIED';
  for (const [pattern, hint] of [[/already.{0,30}(used|consumed)|reus|supersed/i, 'REUSED_OR_SUPERSEDED'], [/revok/i, 'REVOKED'], [/expir/i, 'EXPIRED'], [/audience|resource/i, 'AUDIENCE_OR_RESOURCE'], [/client/i, 'CLIENT'], [/signature/i, 'SIGNATURE'], [/not found|does not exist|unknown/i, 'UNKNOWN_GRANT']]) if (pattern.test(description)) return hint;
  return 'UNSPECIFIED';
}
// Construct a new object from fixed safe fields. Never retain raw token/error
// bodies, client/account IDs, response headers, or caller-supplied extra fields.
export function normalizeRenewalEvent(input) {
  if (!STAGES.includes(input?.stage) || !TRIGGERS.includes(input?.trigger) || !iso(input?.at)) throw new Error('NINJATRADER_RENEWAL_EVENT_INVALID');
  return { at: iso(input.at), stage: input.stage, trigger: input.trigger,
    accessExpiresAt: iso(input.accessExpiresAt), refreshExpiresAtClaim: iso(input.refreshExpiresAtClaim),
    elapsedMs: Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0 && input.elapsedMs <= 1e9 ? input.elapsedMs : null,
    httpStatus: Number.isInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599 ? input.httpStatus : null,
    oauthError: OAUTH_ERRORS.includes(input.oauthError) ? input.oauthError : null,
    serverHint: HINTS.includes(input.serverHint) ? input.serverHint : null,
    outcomeCode: /^NINJATRADER_[A-Z0-9_]{1,100}$/.test(input.outcomeCode || '') ? input.outcomeCode : null,
    rotated: typeof input.rotated === 'boolean' ? input.rotated : null,
    requestId: /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(input.requestId || '') ? input.requestId : null };
}
export function appendRenewalAudit(directory, environment, input) {
  if (!['demo', 'live'].includes(environment) || !path.isAbsolute(directory)) throw new Error('NINJATRADER_RENEWAL_AUDIT_INVALID');
  const dir = fs.lstatSync(directory);
  if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077)) throw new Error('NINJATRADER_RENEWAL_AUDIT_NOT_PRIVATE');
  const file = path.join(directory, `${environment}-renewal.json`), event = normalizeRenewalEvent(input);
  let prior = { events: [], successfulRenewals: 0 };
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.size > 65536) throw new Error('NINJATRADER_RENEWAL_AUDIT_NOT_PRIVATE');
    prior = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (prior.schema !== 'executionos.ninjatrader.renewal.v1' || prior.environment !== environment || !Array.isArray(prior.events) || prior.events.length > 20
        || !Number.isSafeInteger(prior.successfulRenewals) || prior.successfulRenewals < 0) throw new Error('NINJATRADER_RENEWAL_AUDIT_INVALID');
  }
  const audit = { schema: 'executionos.ninjatrader.renewal.v1', environment,
    successfulRenewals: prior.successfulRenewals + Number(event.stage === 'SUCCEEDED'), events: [...prior.events.map(normalizeRenewalEvent), event].slice(-20) };
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return audit;
}
