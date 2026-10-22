import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeRenewalEvent, appendRenewalAudit, renewalExpiryClaim, renewalServerHint } from '../schwab-bridge/ninjatrader-renewal-audit.mjs';
import { createNinjaTraderAuthLogger } from '../schwab-bridge/ninjatrader-monitor.mjs';
const at = '2026-10-20T14:00:00.000Z';
function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'nt-audit-')); fs.chmodSync(dir,0o700); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return dir; }
const event = (extra = {}) => ({ at, stage:'FAILED',trigger:'scheduled',httpStatus:200,oauthError:'invalid_token',serverHint:'EXPIRED',outcomeCode:'NINJATRADER_REFRESH_TOKEN_REJECTED_REAUTHORIZE_REQUIRED',...extra });
test('safe event allowlist drops tokens, raw descriptions, arbitrary errors and unsafe correlation strings', () => {
  const safe=normalizeRenewalEvent(event({ access_token:'SECRET',refresh_token:'SECRET',error_description:'SECRET',account:'SECRET',requestId:'SECRET',oauthError:'SECRET',outcomeCode:'SECRET',extra:'SECRET' }));
  assert.ok(!JSON.stringify(safe).includes('SECRET'));assert.equal(safe.requestId,null);assert.equal(safe.oauthError,null);
  assert.throws(()=>normalizeRenewalEvent(event({trigger:'SECRET'})),/EVENT_INVALID/);
});
test('the JWT expiry diagnostic reads only a bounded unverified expiry claim', () => {
  const jwt='e30.'+Buffer.from(JSON.stringify({ exp: 1792591200,sub:'SECRET',email:'SECRET' })).toString('base64url')+'.signature';
  assert.equal(renewalExpiryClaim(jwt),new Date(1792591200000).toISOString());
  for(const bad of ['SECRET','a.b.c','x'.repeat(33000)])assert.equal(renewalExpiryClaim(bad),null);
});
test('raw server descriptions become categories without retaining their content', () => {
  assert.equal(renewalServerHint('Refresh token already consumed SECRET'),'REUSED_OR_SUPERSEDED');
  assert.equal(renewalServerHint('Token expired SECRET'),'EXPIRED');
  assert.equal(renewalServerHint('SECRET'),'UNSPECIFIED'); assert.equal(renewalServerHint('x'.repeat(2050)),'UNSPECIFIED');
});
test('private audit is bounded, counts successful rotations and separates environments', t => {
  const dir=directory(t); for(let i=0;i<30;i++)appendRenewalAudit(dir,'demo',event({stage:i%2?'SUCCEEDED':'STARTED'}));
  const file=path.join(dir,'demo-renewal.json'),audit=JSON.parse(fs.readFileSync(file));
  assert.equal(audit.events.length,20);assert.equal(audit.successfulRenewals,15);assert.equal(fs.statSync(file).mode&0o777,0o600);
  assert.equal(fs.existsSync(path.join(dir,'live-renewal.json')),false);
});
test('audit refuses symlinks, loose permissions and corrupt existing data', t => {
  const dir=directory(t), target=path.join(dir,'target'), file=path.join(dir,'demo-renewal.json');fs.writeFileSync(target,'untouched');fs.symlinkSync(target,file);
  assert.throws(()=>appendRenewalAudit(dir,'demo',event()),/NOT_PRIVATE/);assert.equal(fs.readFileSync(target,'utf8'),'untouched');fs.unlinkSync(file);
  fs.writeFileSync(file,'{}',{mode:0o644});assert.throws(()=>appendRenewalAudit(dir,'demo',event()),/NOT_PRIVATE/);
  fs.chmodSync(file,0o600);assert.throws(()=>appendRenewalAudit(dir,'demo',event()),/AUDIT_INVALID/);assert.equal(fs.readFileSync(file,'utf8'),'{}');
});
test('console logs renewal outcomes once and suppresses repeated identical failures', () => {
  const lines=[], log=createNinjaTraderAuthLogger(line=>lines.push(line));
  log(event({stage:'STARTED'})); log(event()); log(event({at:'2026-10-20T14:00:15Z'}));assert.equal(lines.length,1);
  assert.match(lines[0],/OAuth error:\s+invalid_token/);assert.match(lines[0],/Server hint:\s+EXPIRED/);
  log(event({stage:'SUCCEEDED',rotated:true,accessExpiresAt:'2026-10-20T15:20:00Z'})); assert.equal(lines.length,2);assert.match(lines[1],/TOKEN RENEWAL SUCCEEDED/);
  log(event());assert.equal(lines.length,3);assert.ok(lines.every(line=>!/[\r\n]/.test(line)));
});
