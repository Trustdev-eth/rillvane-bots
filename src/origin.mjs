import {randomUUID} from 'node:crypto';
import {extractMessage, serializeTransaction, signBytes} from '../../rillvane/backend/chain.mjs';
import {MIN_REQUEST_MS, ORIGIN} from './config.mjs';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createGate(minMs) {
  let last = 0;
  let chain = Promise.resolve();
  return fn => {
    const job = chain.then(async () => {
      const wait = last + minMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await fn();
      } finally {
        last = Date.now();
      }
    });
    chain = job.catch(() => {});
    return job;
  };
}

export const gate = createGate(MIN_REQUEST_MS);
const swapLock = createGate(0);

function signMessage(keypair, text) {
  return signBytes(keypair, Buffer.from(text, 'utf8')).toString('base64');
}

function signPreparedTransaction(keypair, wireB64) {
  const message = extractMessage(Buffer.from(wireB64, 'base64'));
  return serializeTransaction(message, [signBytes(keypair, message)]).toString('base64');
}

export class OriginSession {
  constructor({origin = ORIGIN, keypair}) {
    this.origin = origin;
    this.keypair = keypair;
    this.wallet = keypair.publicKey;
    this.cookie = '';
  }

  async send(path, body, extra = {}) {
    const headers = {
      origin: this.origin,
      ...(body ? {'content-type': 'application/json'} : {}),
      ...(this.cookie ? {cookie: this.cookie} : {}),
      ...extra.headers
    };
    const response = await fetch(this.origin + path, {
      method: body ? 'POST' : extra.method || 'GET',
      headers,
      ...(body ? {body: JSON.stringify(body)} : {}),
      signal: AbortSignal.timeout(extra.timeout || 20000)
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      const error = new Error(data.error || path + ' failed.');
      error.status = response.status;
      error.code = data.code;
      error.retryAfter = Number(response.headers.get('retry-after') || 0);
      throw error;
    }
    return data;
  }

  request(path, body, extra = {}) {
    const run = () => this.send(path, body, extra);
    return extra.ungated ? run() : gate(run);
  }

  async login() {
    const challenge = await this.request('/api/auth/challenge', {wallet: this.wallet});
    return this.request('/api/auth/verify', {
      nonce: challenge.nonce,
      signature: signMessage(this.keypair, challenge.message)
    });
  }

  async ensureSession() {
    try {
      return await this.portfolio();
    } catch (error) {
      if (error.status !== 401) throw error;
      await this.login();
      return this.portfolio();
    }
  }

  portfolio() {
    return this.request('/api/v1/me/portfolio');
  }

  faucetStatus() {
    return this.request('/api/v1/faucet/claims');
  }

  async submitIntent(intentId, {signTransaction = false, ungated = false} = {}) {
    const prepared = await this.request('/api/v1/intents/' + intentId + '/prepare', {}, {ungated});
    const payload = {signature: signMessage(this.keypair, prepared.message)};
    if (signTransaction) {
      if (!prepared.transaction) throw new Error('Origin did not return a transaction to sign.');
      payload.signedTransaction = signPreparedTransaction(this.keypair, prepared.transaction);
    }
    return this.request('/api/v1/intents/' + intentId + '/submission', payload, {ungated});
  }

  async faucet(asset, amount) {
    const intent = await this.request('/api/v1/faucet/claims', {asset, amountIn: String(amount)}, {
      headers: {'Idempotency-Key': randomUUID()}
    });
    return this.submitIntent(intent.id, {signTransaction: false});
  }

  async swap({side, amountIn}) {
    return swapLock(async () => {
      const quote = await this.request('/api/v1/quotes/swap', {side, amountIn: String(amountIn)});
      const intent = await this.request('/api/v1/intents', {quoteId: quote.quoteId}, {
        headers: {'Idempotency-Key': randomUUID()},
        ungated: true
      });
      return this.submitIntent(intent.id, {signTransaction: true, ungated: true});
    });
  }
}

export async function originHealth(origin = ORIGIN) {
  const response = await fetch(origin + '/api/health', {signal: AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error('Origin is not healthy.');
  return response.json();
}
