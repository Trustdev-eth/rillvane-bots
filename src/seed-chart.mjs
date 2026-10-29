import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {DATABASE_PATH} from './config.mjs';
import {log} from './log.mjs';
import {publishOraclePrice} from './market.mjs';

const FEE_BPS = 10;
const MAX_IMPACT_BPS = 40;
const QUOTE_CASH = 1_000_000;

const MARKS = [
  [0.00, 101.6],
  [0.08, 100.4],
  [0.16, 98.2],
  [0.24, 96.8],
  [0.32, 97.1],
  [0.40, 99.6],
  [0.48, 101.3],
  [0.54, 100.5],
  [0.62, 103.4],
  [0.70, 102.6],
  [0.78, 99.2],
  [0.84, 97.9],
  [0.90, 98.4],
  [0.95, 100.2],
  [1.00, 100.5]
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function rawPrice(price) {
  return String(Math.round(price * 1_000_000));
}

function rawUnits(amount) {
  return String(Math.round(amount * 1_000_000));
}

export function pathPrice(frac, marks = MARKS) {
  const t = Math.min(1, Math.max(0, frac));
  let i = 0;
  while (i < marks.length - 2 && marks[i + 1][0] < t) i++;
  const [t0, p0] = marks[i];
  const [t1, p1] = marks[i + 1];
  const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  return p0 + (p1 - p0) * u;
}

function execPrice(buy, quoteAmount, oracle) {
  const impact = Math.min(MAX_IMPACT_BPS, quoteAmount * 10_000 / QUOTE_CASH);
  const bps = 10_000 - FEE_BPS - impact;
  return buy ? oracle * 10_000 / bps : oracle * bps / 10_000;
}

function clamp(price) {
  return Math.min(112, Math.max(90, price));
}

export function buildSeedRows({hours = 72, now = Date.now(), rand = Math.random} = {}) {
  const start = now - hours * 3_600_000;
  const end = now - 12_000;
  const span = Math.max(1, end - start);
  const barMs = 300_000;
  const rows = [];
  let close = pathPrice(0);
  const firstBar = Math.floor(start / barMs) * barMs;

  for (let bar = firstBar; bar < end; bar += barMs) {
    const t0 = Math.max(bar + 1_000, start);
    const t1 = Math.min(bar + barMs - 1_000, end);
    if (t1 <= t0 + 20_000) continue;

    const target = pathPrice(Math.min(1, (bar + barMs - start) / span));
    const drift = target - close;
    const falling = drift < -0.02;
    const intensity = Math.min(0.014, Math.max(0.0015, Math.abs(drift) / Math.max(1, close) + 0.0018 + rand() * 0.0024));
    const range = close * intensity;
    const open = close;
    close = clamp(open + drift * (0.4 + rand() * 0.45) + (rand() - 0.5) * range * 0.22);
    const high = Math.min(113, Math.max(open, close) + range * (0.18 + rand() * 0.45));
    const low = Math.max(89, Math.min(open, close) - range * (0.18 + rand() * 0.45));
    const n = falling || intensity > 0.006 ? 7 + Math.floor(rand() * 7) : 5 + Math.floor(rand() * 5);
    const seq = [];

    for (let i = 0; i < n; i++) {
      const u = (i + 0.1 + rand() * 0.8) / n;
      let px;
      if (u < 0.38) {
        const extreme = falling ? low : high;
        px = open + (extreme - open) * (u / 0.38);
      } else if (u < 0.72) {
        const from = falling ? low : high;
        const to = falling ? high : low;
        px = from + (to - from) * ((u - 0.38) / 0.34);
      } else {
        px = (falling ? low : high) + (close - (falling ? low : high)) * ((u - 0.72) / 0.28);
      }
      px += (rand() - 0.5) * range * 0.05;
      seq.push({u, px: Math.min(high, Math.max(low, px))});
    }

    seq.sort((a, b) => a.u - b.u);
    seq[0].px = open;
    seq[seq.length - 1].px = close;

    for (let i = 0; i < seq.length; i++) {
      const buy = rand() < (falling ? 0.38 : 0.62);
      const quote = 6 + rand() * 20 + (rand() < 0.06 ? 18 + rand() * 28 : 0);
      const exec = execPrice(buy, quote, seq[i].px);
      const created = Math.floor(t0 + (i + rand() * 0.4) / n * (t1 - t0));
      rows.push({
        side: buy ? 'buy' : 'sell',
        price: rawPrice(exec),
        base: rawUnits(quote / exec),
        quote: rawUnits(quote),
        created
      });
    }
  }

  return {rows, lastPrice: close, start, end};
}

export function seedChart({hours = 72, now = Date.now(), path = DATABASE_PATH, replace = false} = {}) {
  if (!existsSync(path)) throw new Error('Origin database not found at ' + path);
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout=8000;');
    const seeded = db.prepare('SELECT COUNT(*) AS n FROM trades WHERE slot=0').get();
    if (!replace && (seeded?.n || 0) >= 80) {
      log({event: 'seed.skip', reason: 'history-already-present', count: seeded.n});
      return {inserted: 0, skipped: true};
    }
    const {rows, lastPrice, start} = buildSeedRows({hours, now, rand: mulberry32(20261029)});
    db.exec('BEGIN IMMEDIATE');
    if (replace) db.prepare('DELETE FROM trades').run();
    else db.prepare('DELETE FROM trades WHERE slot=0').run();
    const insert = db.prepare('INSERT INTO trades(side,price,base_amount,quote_amount,slot,created) VALUES(?,?,?,?,?,?)');
    for (const row of rows) insert.run(row.side, row.price, row.base, row.quote, 0, row.created);
    db.exec('COMMIT');
    publishOraclePrice(lastPrice, path);
    log({event: 'seed.ok', inserted: rows.length, hours, replace, lastPrice: Number(lastPrice.toFixed(4)), from: new Date(start).toISOString()});
    return {inserted: rows.length, skipped: false, lastPrice};
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    db.close();
  }
}
