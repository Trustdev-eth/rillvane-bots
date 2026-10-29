import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSeedRows, pathPrice} from '../src/seed-chart.mjs';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

test('seed path has dump, hold, and rally legs', () => {
  const samples = [0, 0.24, 0.32, 0.62, 0.84, 1].map(frac => pathPrice(frac));
  assert.ok(samples[1] < samples[0] - 2, samples.join(','));
  assert.ok(Math.abs(samples[2] - samples[1]) < 1.2, samples.join(','));
  assert.ok(samples[3] > samples[2] + 3, samples.join(','));
  assert.ok(samples[4] < samples[3] - 3, samples.join(','));
});

test('seeded 1h candles stay in a real market range', () => {
  const {rows, lastPrice} = buildSeedRows({hours: 72, now: Date.parse('2026-10-29T00:00:00Z'), rand: mulberry32(7)});
  assert.ok(rows.length > 2000, rows.length);
  const prices = rows.map(row => Number(row.price) / 1_000_000);
  assert.ok(Math.min(...prices) > 88);
  assert.ok(Math.max(...prices) < 114);
  assert.ok(lastPrice > 96 && lastPrice < 105, lastPrice);

  const buckets = new Map();
  for (const row of rows) {
    const t = Math.floor(row.created / 3_600_000) * 3_600_000;
    const price = Number(row.price) / 1_000_000;
    const bucket = buckets.get(t) || {high: price, low: price};
    bucket.high = Math.max(bucket.high, price);
    bucket.low = Math.min(bucket.low, price);
    buckets.set(t, bucket);
  }
  const ranges = [...buckets.values()].map(bucket => (bucket.high - bucket.low) / bucket.low);
  assert.ok(ranges.length > 48, ranges.length);
  assert.ok(Math.max(...ranges) < 0.07, Math.max(...ranges));
  assert.ok(ranges.filter(range => range > 0.002).length > ranges.length * 0.7);
});
