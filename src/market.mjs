import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {PRICE_SCALE} from '../../rillvane/backend/math.mjs';
import {refreshOracle} from '../../rillvane/backend/protocol.mjs';
import {DATABASE_PATH} from './config.mjs';
import {log} from './log.mjs';

const MIN_PRICE = 90;
const MAX_PRICE = 112;
const PHASES = {
  dump: {bias: -1, minutes: [35, 70], stepBps: [2, 6], buyProb: 0.32},
  crash: {bias: -1, minutes: [16, 28], stepBps: [5, 10], buyProb: 0.22},
  hold: {bias: 0, minutes: [28, 55], stepBps: [0.8, 2.4], buyProb: 0.5},
  range: {bias: 0, minutes: [32, 65], stepBps: [1.2, 3.2], buyProb: 0.48},
  recover: {bias: 1, minutes: [40, 75], stepBps: [2, 5.5], buyProb: 0.7},
  rally: {bias: 1, minutes: [32, 60], stepBps: [2.4, 6.5], buyProb: 0.78},
  grind: {bias: 1, minutes: [40, 80], stepBps: [1, 3], buyProb: 0.58}
};

function pick(min, max) {
  return min + Math.random() * (max - min);
}

function pickOne(ids) {
  return ids[Math.floor(Math.random() * ids.length)];
}

function clampPrice(price) {
  return Math.min(MAX_PRICE, Math.max(MIN_PRICE, price));
}

export function nextPhaseId(prevId, price) {
  if (price <= MIN_PRICE + 2) return pickOne(['recover', 'rally', 'grind']);
  if (price >= MAX_PRICE - 2) return pickOne(['dump', 'crash', 'range']);
  const prev = PHASES[prevId];
  if (prev?.bias < 0) return pickOne(['hold', 'range', 'recover', 'grind']);
  if (prev?.bias > 0) return pickOne(['hold', 'range', 'grind', 'dump']);
  return pickOne(['dump', 'rally', 'recover', 'range', 'grind', 'hold']);
}

export function stepPrice(price, phase, rand = Math.random) {
  const spec = PHASES[phase.id] || PHASES.range;
  const magnitude = (spec.stepBps[0] + (spec.stepBps[1] - spec.stepBps[0]) * rand()) / 10_000;
  const noise = (rand() - 0.5) * magnitude * 0.28;
  const delta = spec.bias === 0 ? (rand() - 0.5) * 2 * magnitude : spec.bias * magnitude;
  return clampPrice(price * (1 + delta + noise));
}

function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=8000;');
  return db;
}

export function readOraclePrice(path = DATABASE_PATH) {
  if (!existsSync(path)) return 100;
  const db = openDb(path);
  try {
    const row = db.prepare('SELECT price FROM markets WHERE id=?').get('rlvn-usdc');
    const raw = Number(row?.price);
    return Number.isFinite(raw) && raw > 0 ? raw / Number(PRICE_SCALE) : 100;
  } finally {
    db.close();
  }
}

export function publishOraclePrice(price, path = DATABASE_PATH) {
  const db = openDb(path);
  try {
    const raw = BigInt(Math.round(clampPrice(price) * Number(PRICE_SCALE)));
    return refreshOracle(db, Date.now(), raw);
  } finally {
    db.close();
  }
}

function makePhase(id) {
  const spec = PHASES[id];
  const minutes = pick(spec.minutes[0], spec.minutes[1]);
  return {
    id,
    bias: spec.bias,
    buyProb: spec.buyProb,
    stepBps: spec.stepBps,
    until: Date.now() + minutes * 60_000
  };
}

export function createDirector({path = DATABASE_PATH} = {}) {
  const state = {
    price: readOraclePrice(path),
    phase: makePhase('range')
  };
  return {
    state,
    tick() {
      if (Date.now() >= state.phase.until) {
        state.phase = makePhase(nextPhaseId(state.phase.id, state.price));
        log({event: 'regime.next', phase: state.phase.id, price: Number(state.price.toFixed(4)), until: new Date(state.phase.until).toISOString()});
      }
      state.price = stepPrice(state.price, state.phase);
      publishOraclePrice(state.price, path);
      log({event: 'regime.tick', phase: state.phase.id, price: Number(state.price.toFixed(4)), buyProb: state.phase.buyProb});
      return state;
    }
  };
}

export async function runDirector(director, stop, intervalMs = 18_000) {
  director.tick();
  while (!stop.flag) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    if (stop.flag) break;
    try {
      director.tick();
    } catch (error) {
      log({event: 'regime.err', error: error.message});
    }
  }
}

export {PHASES, MIN_PRICE, MAX_PRICE};
