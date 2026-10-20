import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { discoverOAuthServerInfo } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthTokensSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

export const NINJATRADER_ENDPOINTS = Object.freeze({
  demo: 'https://mcp-demo.tradovateapi.com/mcp',
  live: 'https://mcp-live.tradovateapi.com/mcp',
});
const TOOLS = new Set(['describe', 'search_contracts', 'market_snapshot', 'market_history']);
const UPDATE_RESOURCES = ['tradovate://orders', 'tradovate://positions'];
const OBSERVATION_TOOLS = ['my_portfolio', 'fill_history', 'order_history'];
export function endpointFor(environment) {
  if (!Object.hasOwn(NINJATRADER_ENDPOINTS, environment)) throw new Error('NINJATRADER_ENVIRONMENT_INVALID');
  return NINJATRADER_ENDPOINTS[environment];
}

// A token rotation has one owner across both CLI and service processes. Never
// automatically steal a lock: an operator must check that its process has ended.
export class NinjaTraderOAuthStore {
  constructor({ directory, environment = 'demo', redirectUrl = 'http://127.0.0.1:8791/callback', onAuthorize, now = Date.now } = {}) {
    this.now = now;
    this.endpoint = endpointFor(environment);
    this.issuer = `https://${environment}.tradovateapi.com`;
    this.environment = environment;
    const callback = new URL(redirectUrl);
    if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' || callback.pathname !== '/callback'
        || callback.username || callback.password || callback.search || callback.hash) throw new Error('NINJATRADER_CALLBACK_INVALID');
    this.redirectUrl = callback.toString();
    if (!directory || !path.isAbsolute(directory)) throw new Error('NINJATRADER_AUTH_DIRECTORY_MUST_BE_ABSOLUTE');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('NINJATRADER_AUTH_DIRECTORY_NOT_PRIVATE');
    this.file = path.join(directory, `${environment}.json`);
    this.lock = path.join(directory, `${environment}.lock`);
    try { this.lockFd = fs.openSync(this.lock, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('NINJATRADER_AUTH_STORE_LOCKED');
      if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) throw new Error('NINJATRADER_AUTH_STORE_NOT_WRITABLE');
      throw new Error('NINJATRADER_AUTH_STORE_OPEN_FAILED');
    }
    fs.writeFileSync(this.lockFd, String(process.pid));
    this.onAuthorize = onAuthorize;
    this.pendingState = crypto.randomBytes(32).toString('base64url');
    this.data = {};
    try {
      if (fs.existsSync(this.file)) {
        const fileStat = fs.lstatSync(this.file);
        if (!fileStat.isFile() || fileStat.isSymbolicLink() || (fileStat.mode & 0o077)) throw new Error('NINJATRADER_AUTH_FILE_NOT_PRIVATE');
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (this.data.resource !== this.endpoint) throw new Error('NINJATRADER_AUTH_ENVIRONMENT_MISMATCH');
      }
    } catch (error) { this.close(); throw error; }
  }
  get clientMetadata() {
    return { client_name: 'ExecutionOS read-only market data', redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'mcp:connect' };
  }
  state() { return this.pendingState; }
  clientInformation() { return this.data.client; }
  saveClientInformation(client) {
    if (client.issuer && client.issuer !== this.issuer) throw new Error('NINJATRADER_CLIENT_ISSUER_MISMATCH');
    // Keep registration changes in memory until a successful token exchange.
    this.data = { ...this.data, client };
  }
  tokens() { return this.data.tokens; }
  saveTokens(tokens) {
    if (tokens?.error || typeof tokens?.access_token !== 'string' || !tokens.access_token || typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error('NINJATRADER_TOKEN_RESPONSE_INVALID');
    if (tokens.issuer && tokens.issuer !== this.issuer) throw new Error('NINJATRADER_TOKEN_ISSUER_MISMATCH');
    this.persist({ tokens, expiresAt: this.now() + tokens.expires_in * 1000 });
  }
  saveCodeVerifier(value) { this.verifier = value; }
  codeVerifier() { if (!this.verifier) throw new Error('NINJATRADER_PKCE_MISSING'); return this.verifier; }
  async validateResourceURL(serverUrl, resource) {
    if (String(serverUrl) !== this.endpoint || (resource && resource !== this.endpoint)) throw new Error('NINJATRADER_RESOURCE_MISMATCH');
    return new URL(this.endpoint);
  }
  redirectToAuthorization(url) {
    // First-party authorization metadata points the browser at this distinct
    // consent origin. Tokens/registration remain on the selected API issuer.
    if (url.origin !== 'https://web.ninjatrader.com' || url.pathname !== '/oauth'
        || url.searchParams.get('env') !== this.environment || url.searchParams.getAll('env').length !== 1) throw new Error('NINJATRADER_AUTH_ORIGIN_REJECTED');
    if (!this.onAuthorize) throw new Error('NINJATRADER_AUTHORIZATION_REQUIRED_RUN_AUTH_COMMAND');
    return this.onAuthorize(url);
  }
  // Failed refresh never erases the last saved credentials. Reauthorization is
  // explicit; there is no automatic upscoping or permission retry.
  invalidateCredentials() { throw new Error('NINJATRADER_REAUTHORIZE_REQUIRED_CREDENTIALS_PRESERVED'); }
  persist(update) {
    const next = { ...this.data, ...update, resource: this.endpoint };
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, this.file);
      this.data = next;
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  close() {
    if (this.lockFd !== undefined) {
      fs.closeSync(this.lockFd); this.lockFd = undefined;
      try { fs.unlinkSync(this.lock); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

export class NinjaTraderReadOnlyClient {
  #client; #transport; #pending; #tools; #tail = Promise.resolve(); #last = new Map(); #blockedUntil = 0;
  #streamOpen = false; #updateListener = null; #updatesActive = false; #subscriptionClient; #subscriptionRetryAt = 0; #streamFailed = false;
  #allowedTools; #accountObservation; #authMetadata; #refreshPending; #refreshRetryAt = 0; #refreshFailure = null; #forceRefresh = false; #terminalRefreshFailure = null;
  constructor({ environment = 'demo', oauthProvider, fetchImpl = fetch, now = Date.now, minIntervalMs = 1000, accountObservation = false } = {}) {
    this.endpoint = endpointFor(environment);
    this.issuer = `https://${environment}.tradovateapi.com`;
    if (!oauthProvider || oauthProvider.endpoint !== this.endpoint) throw new Error('NINJATRADER_AUTH_ENVIRONMENT_MISMATCH');
    if (!Number.isFinite(minIntervalMs) || minIntervalMs < 1000) throw new Error('NINJATRADER_RATE_POLICY_INVALID');
    if (typeof accountObservation !== 'boolean') throw new Error('NINJATRADER_OBSERVATION_MODE_INVALID');
    this.#accountObservation = accountObservation;
    this.#allowedTools = new Set([...TOOLS, ...(accountObservation ? OBSERVATION_TOOLS : [])]);
    this.oauth = oauthProvider; this.now = now; this.minIntervalMs = minIntervalMs;
    this.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== new URL(this.endpoint).origin && url.origin !== this.issuer) throw new Error('NINJATRADER_NETWORK_ORIGIN_REJECTED');
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('NINJATRADER_NETWORK_ORIGIN_REJECTED');
      if (url.href === this.endpoint && (init.method || 'GET') === 'POST') {
        let message;
        try { message = JSON.parse(init.body); } catch { throw new Error('NINJATRADER_RPC_DENIED'); }
        const observationResource = this.#accountObservation && ((message.method === 'resources/read'
          && ['tradovate://account-list', ...UPDATE_RESOURCES].includes(message.params?.uri))
          || (['resources/subscribe', 'resources/unsubscribe'].includes(message.method) && UPDATE_RESOURCES.includes(message.params?.uri)));
        if ((!observationResource && !['initialize', 'notifications/initialized', 'notifications/cancelled', 'tools/list', 'tools/call', 'ping'].includes(message.method))
            || (message.method === 'tools/call' && !this.#allowedTools.has(message.params?.name))) throw new Error('NINJATRADER_RPC_DENIED');
      }
      const isMcp = url.href === this.endpoint;
      if (isMcp && this.now() < this.#blockedUntil) throw new Error('NINJATRADER_RATE_LIMIT_COOLDOWN');
      if (isMcp && this.oauth.tokens()?.access_token) {
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${this.oauth.tokens().access_token}`);
        init = { ...init, headers };
      }
      // Bound connection/header time for the long-lived notification GET,
      // without aborting its body every 15 seconds. POST RPCs stay bounded.
      const stream = isMcp && init.method === 'GET', headerTimeout = new AbortController();
      const timer = stream ? setTimeout(() => headerTimeout.abort(), 15000) : null;
      let response;
      try { response = await fetchImpl(input, { ...init, redirect: 'error',
        signal: AbortSignal.any([...(init.signal ? [init.signal] : []), stream ? headerTimeout.signal : AbortSignal.timeout(15000)]) }); }
      finally { if (timer) clearTimeout(timer); }
      if (stream) this.#streamOpen = response.ok && response.headers.get('content-type')?.split(';')[0].trim() === 'text/event-stream';
      if (isMcp && response.status === 401) this.#forceRefresh = true;
      if (isMcp && response.status === 429) {
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - this.now();
        this.#blockedUntil = this.now() + Math.max(60000, Number.isFinite(seconds) ? seconds : 0);
        throw new Error('NINJATRADER_RATE_LIMIT_COOLDOWN');
      }
      return response;
    };
  }
  async connect() {
    if (!this.#pending) this.#pending = this.#connect().catch(async error => {
      await this.close();
      throw new Error(/^NINJATRADER_[A-Z0-9_]+$/.test(error.message) ? error.message : 'NINJATRADER_CONNECT_FAILED_CHECK_AUTH_AND_BETA_ACCESS');
    });
    return this.#pending;
  }
  async #connect() {
    if (!this.oauth.tokens()) throw new Error('NINJATRADER_AUTHORIZATION_REQUIRED');
    await this.#refresh();
    this.#client = new Client({ name: 'ExecutionOS-read-only', version: '0.1.0' }, { capabilities: {} });
    this.#client.setNotificationHandler(ResourceUpdatedNotificationSchema, notification => {
      if (UPDATE_RESOURCES.includes(notification.params.uri)) {
        try { this.#updateListener?.(notification.params.uri); } catch { /* A wakeup cannot change broker state. */ }
      }
    });
    this.#client.onerror = () => {
      this.#streamOpen = false;
      if (this.#updateListener) { this.#updatesActive = false; this.#streamFailed = true; this.#subscriptionRetryAt = this.now() + 60000; }
    };
    this.#transport = new StreamableHTTPClientTransport(new URL(this.endpoint), { fetch: this.fetch,
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 } });
    await this.#client.connect(this.#transport, { timeout: 20000 });
    const tools = []; let cursor;
    for (let page = 0; page < 20; page++) {
      const result = await this.#client.listTools(cursor ? { cursor } : {}, { timeout: 15000 });
      tools.push(...result.tools.filter(tool => this.#allowedTools.has(tool.name)));
      cursor = result.nextCursor;
      if (!cursor) break;
      if (page === 19) throw new Error('NINJATRADER_TOOL_DISCOVERY_LIMIT');
    }
    this.#tools = new Map(tools.map(tool => [tool.name, tool]));
    await this.#ensureAccountUpdates();
  }
  async #ensureAccountUpdates() {
    if (!this.#updateListener || this.#streamFailed) return false;
    if (this.#updatesActive && this.#subscriptionClient === this.#client) return true;
    if (this.now() < this.#subscriptionRetryAt) return false;
    if (!this.#streamOpen) return false;
    this.#subscriptionRetryAt = this.now() + 60000;
    if (!this.#client.getServerCapabilities()?.resources?.subscribe) return false;
    try {
      for (const uri of UPDATE_RESOURCES) await this.#client.subscribeResource({ uri }, { timeout: 15000 });
      if (this.#streamFailed || !this.#streamOpen) return false;
      this.#subscriptionClient = this.#client; this.#updatesActive = true; return true;
    } catch { return false; } // Polling remains authoritative if subscriptions are unavailable.
  }
  async watchAccountUpdates(listener) {
    if (!this.#accountObservation) throw new Error('NINJATRADER_RESOURCE_DENIED');
    if (typeof listener !== 'function') throw new Error('NINJATRADER_UPDATE_LISTENER_INVALID');
    const run = this.#tail.then(async () => { this.#updateListener = listener; await this.connect(); return this.#ensureAccountUpdates(); });
    this.#tail = run.catch(() => {}); return run;
  }
  stopAccountUpdates() { this.#updateListener = null; }
  async #prepareObservationConnection() {
    // A dead notification stream must not stop polling. Retry its session at
    // most once a minute, and restore subscriptions after normal reconnects.
    if (this.#streamFailed && this.now() >= this.#subscriptionRetryAt) await this.close();
    await this.connect(); await this.#ensureAccountUpdates();
  }
  // Refresh is non-interactive: never register another client, discard tokens,
  // or fall back to browser consent after a network/server/parse failure.
  async #refresh({ force = false } = {}) {
    const expiresAt = this.oauth.data?.expiresAt;
    if (!force && !this.#forceRefresh && (!expiresAt || this.now() < expiresAt - 300000)) return;
    if (this.#terminalRefreshFailure) throw new Error(this.#terminalRefreshFailure);
    if (this.now() < this.#refreshRetryAt) {
      if (!force && !this.#forceRefresh && this.now() < expiresAt) return;
      throw new Error(this.#refreshFailure || 'NINJATRADER_TOKEN_REFRESH_TEMPORARILY_UNAVAILABLE');
    }
    if (!this.#refreshPending) this.#refreshPending = this.#performRefresh().finally(() => { this.#refreshPending = undefined; });
    try { await this.#refreshPending; }
    catch (error) {
      const code = /^NINJATRADER_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'NINJATRADER_TOKEN_REFRESH_TEMPORARILY_UNAVAILABLE';
      this.#refreshFailure = code;
      if (/REAUTHORIZE_REQUIRED|CONFIGURATION_REJECTED|AUTH_STORE_WRITE_FAILED/.test(code)) this.#terminalRefreshFailure = code;
      else this.#refreshRetryAt = Math.max(this.#refreshRetryAt, this.now() + 15000);
      // Keep using an actually unexpired access token during a transient
      // refresh outage. Once it expires, fail reads until refresh recovers.
      if (!force && !this.#forceRefresh && code === 'NINJATRADER_TOKEN_REFRESH_TEMPORARILY_UNAVAILABLE' && this.now() < expiresAt) return;
      throw new Error(code);
    }
  }
  async #performRefresh() {
    const tokens = this.oauth.tokens(), registration = this.oauth.clientInformation?.();
    if (!tokens?.refresh_token) throw new Error('NINJATRADER_REFRESH_TOKEN_MISSING_REAUTHORIZE_REQUIRED');
    if (!registration?.client_id) throw new Error('NINJATRADER_REFRESH_CLIENT_MISSING_REAUTHORIZE_REQUIRED');
    if ((tokens.issuer && tokens.issuer !== this.issuer) || (registration.issuer && registration.issuer !== this.issuer)) throw new Error('NINJATRADER_REFRESH_CONFIGURATION_REJECTED');
    if (!this.#authMetadata) {
      const info = await discoverOAuthServerInfo(new URL(this.endpoint), { fetchFn: this.fetch });
      const metadata = info.authorizationServerMetadata;
      if (info.authorizationServerUrl !== this.issuer || info.resourceMetadata?.resource !== this.endpoint || metadata?.issuer !== this.issuer
          || !metadata.token_endpoint || new URL(metadata.token_endpoint).origin !== this.issuer) throw new Error('NINJATRADER_REFRESH_CONFIGURATION_REJECTED');
      this.#authMetadata = metadata;
    }
    const response = await this.fetch(this.#authMetadata.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: registration.client_id, resource: this.endpoint }) });
    if (response.status === 429) {
      const retry = response.headers.get('retry-after');
      const wait = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - this.now();
      this.#refreshRetryAt = this.now() + Math.max(15000, Number.isFinite(wait) ? wait : 60000);
      throw new Error('NINJATRADER_TOKEN_REFRESH_TEMPORARILY_UNAVAILABLE');
    }
    if (response.status >= 500) throw new Error('NINJATRADER_TOKEN_REFRESH_TEMPORARILY_UNAVAILABLE');
    let body;
    try { body = await response.json(); } catch { throw new Error('NINJATRADER_TOKEN_REFRESH_TEMPORARILY_UNAVAILABLE'); }
    // This beta also returns OAuth errors inside HTTP 200 responses.
    if (['invalid_token', 'invalid_grant', 'access_denied'].includes(body?.error)) throw new Error('NINJATRADER_REFRESH_TOKEN_REJECTED_REAUTHORIZE_REQUIRED');
    if (['invalid_client', 'unauthorized_client'].includes(body?.error)) throw new Error('NINJATRADER_REFRESH_CLIENT_REJECTED_REAUTHORIZE_REQUIRED');
    if (['invalid_scope', 'invalid_target', 'unsupported_grant_type', 'invalid_request'].includes(body?.error)) throw new Error('NINJATRADER_REFRESH_CONFIGURATION_REJECTED');
    if (!response.ok || body?.error) throw new Error('NINJATRADER_TOKEN_REFRESH_TEMPORARILY_UNAVAILABLE');
    const parsed = OAuthTokensSchema.safeParse(body);
    if (!parsed.success || !parsed.data.access_token || !Number.isFinite(parsed.data.expires_in) || parsed.data.expires_in <= 0 || parsed.data.token_type.toLowerCase() !== 'bearer') throw new Error('NINJATRADER_TOKEN_REFRESH_TEMPORARILY_UNAVAILABLE');
    try { this.oauth.saveTokens({ ...parsed.data, refresh_token: parsed.data.refresh_token || tokens.refresh_token, issuer: this.issuer }); }
    catch { throw new Error('NINJATRADER_AUTH_STORE_WRITE_FAILED'); }
    this.#refreshRetryAt = 0; this.#refreshFailure = null; this.#forceRefresh = false;
  }
  async refreshAuthorization() {
    const run = this.#tail.then(() => this.#refresh({ force: true }));
    this.#tail = run.catch(() => {}); return run;
  }
  async toolCatalog() { await this.connect(); return [...this.#tools.values()]; }
  async callTool(name, args) {
    if (!this.#allowedTools.has(name)) throw new Error('NINJATRADER_TOOL_DENIED');
    // Serialize SDK operations, including rotating-token refresh.
    const run = this.#tail.then(async () => {
      await this.#prepareObservationConnection();
      if (!this.#tools.has(name)) throw new Error('NINJATRADER_REQUIRED_TOOL_UNAVAILABLE');
      const tool = this.#tools.get(name);
      if (tool.annotations?.readOnlyHint === false || tool.annotations?.destructiveHint === true) throw new Error('NINJATRADER_TOOL_ANNOTATION_REJECTED');
      if (this.now() < this.#blockedUntil) throw new Error('NINJATRADER_RATE_LIMIT_COOLDOWN');
      const inputCheck = new AjvJsonSchemaValidator().getValidator(tool.inputSchema)(args);
      if (!inputCheck.valid) throw new Error('NINJATRADER_TOOL_INPUT_SCHEMA_MISMATCH');
      const waitMs = this.minIntervalMs - (this.now() - (this.#last.get(name) ?? -Infinity));
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      await this.#refresh(); this.#last.set(name, this.now());
      let result;
      try { result = await this.#client.callTool({ name, arguments: args }, undefined, { timeout: 15000 }); }
      catch (error) { throw new Error(this.now() < this.#blockedUntil ? 'NINJATRADER_RATE_LIMIT_COOLDOWN' : [401, 404].includes(error?.code) ? 'NINJATRADER_SESSION_RECONNECT_REQUIRED' : 'NINJATRADER_TOOL_REQUEST_FAILED'); }
      if (result.isError) { this.#blockedUntil = this.now() + 60000; throw new Error('NINJATRADER_TOOL_ERROR'); }
      if (result.structuredContent) return result.structuredContent;
      const content = result.content;
      if (!Array.isArray(content) || content.length !== 1 || content[0].type !== 'text') throw new Error('NINJATRADER_OUTPUT_BINDING_REQUIRED');
      try { return JSON.parse(content[0].text); } catch { throw new Error('NINJATRADER_OUTPUT_BINDING_REQUIRED'); }
    });
    this.#tail = run.catch(() => {});
    return run;
  }
  async close() {
    try { await this.#client?.close(); } finally { this.#client = undefined; this.#transport = undefined; this.#tools = undefined; this.#pending = undefined; this.#streamOpen = false; this.#updatesActive = false; this.#subscriptionClient = undefined; this.#subscriptionRetryAt = 0; this.#streamFailed = false; }
  }
  readAccountList() { return this.#readObservationResource('tradovate://account-list'); }
  readPositionList() { return this.#readObservationResource('tradovate://positions'); }
  readOrderList() { return this.#readObservationResource('tradovate://orders'); }
  async #readObservationResource(uri) {
    if (!this.#accountObservation) throw new Error('NINJATRADER_RESOURCE_DENIED');
    const run = this.#tail.then(async () => {
      await this.#prepareObservationConnection(); await this.#refresh();
      let result;
      try { result = await this.#client.readResource({ uri }, { timeout: 15000 }); }
      catch (error) { throw new Error(this.now() < this.#blockedUntil ? 'NINJATRADER_RATE_LIMIT_COOLDOWN' : [401, 404].includes(error?.code) ? 'NINJATRADER_SESSION_RECONNECT_REQUIRED' : 'NINJATRADER_OBSERVATION_RESOURCE_READ_FAILED_CHECK_READ_PERMISSIONS'); }
      if (!Array.isArray(result.contents) || result.contents.length !== 1 || typeof result.contents[0].text !== 'string') throw new Error('NINJATRADER_ACCOUNT_LIST_SCHEMA_MISMATCH');
      try { return JSON.parse(result.contents[0].text); } catch { throw new Error('NINJATRADER_ACCOUNT_LIST_SCHEMA_MISMATCH'); }
    });
    this.#tail = run.catch(() => {}); return run;
  }
  async resetConnection() {
    const run = this.#tail.then(() => this.close());
    this.#tail = run.catch(() => {}); return run;
  }
}
