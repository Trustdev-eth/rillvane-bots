import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const BOT_ROOT = resolve(here, '..');
const envPath = resolve(BOT_ROOT, '.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

export const ORIGIN = (process.env.ORIGIN || 'http://localhost:8787').replace(/\/$/, '');
export const REMOTE_ORIGIN = (() => {
  try {
    const host = new URL(ORIGIN).hostname;
    return host !== 'localhost' && host !== '127.0.0.1';
  } catch {
    return false;
  }
})();
export const RILLVANE_ROOT = resolve(BOT_ROOT, process.env.RILLVANE_ROOT || '../rillvane');
export const KEYS_DIR = resolve(BOT_ROOT, process.env.KEYS_DIR || '../rillvane/ops/keys');
export const DATABASE_PATH = resolve(BOT_ROOT, process.env.DATABASE_PATH || '../rillvane/rillvane.sqlite');
export const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
export const WALLET_DIR = resolve(BOT_ROOT, 'wallets');
export const LOG_DIR = resolve(BOT_ROOT, 'logs');
export const SOL_FUND_LAMPORTS = BigInt(process.env.SOL_FUND_LAMPORTS || '50000000');
export const SEED_CHART = !['0', 'false', 'no'].includes(String(process.env.SEED_CHART || '1').toLowerCase());
export const MIN_REQUEST_MS = Number(process.env.MIN_REQUEST_MS || 900);

export const ACCOUNTS = [
  {id: 'maker', strategy: 'maker', name: 'Two-sided maker'},
  {id: 'momentum', strategy: 'momentum', name: 'Momentum follower'},
  {id: 'revert', strategy: 'revert', name: 'Mean reversion'},
  {id: 'noise', strategy: 'noise', name: 'Retail noise'},
  {id: 'whale', strategy: 'whale', name: 'Impact whale'},
  {id: 'twap', strategy: 'twap', name: 'TWAP cycle'}
];
