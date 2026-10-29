import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextPhaseId, stepPrice} from '../src/market.mjs';

test('dump steps move price down and rally steps move it up', () => {
  const rand = () => 0.5;
  const down = stepPrice(100, {id: 'dump'}, rand);
  const up = stepPrice(100, {id: 'rally'}, rand);
  assert.ok(down < 100, down);
  assert.ok(up > 100, up);
});

test('a floor price is followed by a recovering phase', () => {
  assert.ok(['recover', 'rally', 'grind'].includes(nextPhaseId('dump', 90)));
});

test('a ceiling price is followed by a down phase', () => {
  assert.ok(['dump', 'crash', 'range'].includes(nextPhaseId('rally', 112)));
});

test('a dump step stays inside a tight live-tape band', () => {
  const rand = () => 0.5;
  const next = stepPrice(100, {id: 'dump'}, rand);
  assert.ok(next < 100, next);
  assert.ok(100 - next < 0.12, next);
});
