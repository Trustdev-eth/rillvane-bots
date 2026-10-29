import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide, STRATEGY_IDS} from '../src/strategies.mjs';

test('every strategy returns a buy or sell against funded inventory', () => {
  const balances = {USDC: '4000', RLVN: '40'};
  for (const id of STRATEGY_IDS) {
    const decision = decide(id, {balances, tape: [{side: 'buy', price: 100.1}], memory: {}});
    assert.equal(decision.skip, undefined);
    assert.ok(['buy', 'sell'].includes(decision.side), id);
    assert.ok(decision.amountIn > 0, id);
    assert.ok(decision.waitMs > 0, id);
  }
});

test('empty quote inventory flips to a sell when RLVN remains', () => {
  const decision = decide('whale', {balances: {USDC: '0.4', RLVN: '12'}, tape: [], memory: {}});
  assert.equal(decision.side, 'sell');
  assert.ok(decision.amountIn >= 0.01);
});

test('exhausted wallets skip instead of quoting dust', () => {
  const decision = decide('noise', {balances: {USDC: '0', RLVN: '0'}, tape: [], memory: {}});
  assert.equal(decision.skip, true);
});

test('dump regime pushes whale and momentum to sell', () => {
  const regime = {id: 'dump', bias: -1, buyProb: 0};
  const whale = decide('whale', {balances: {USDC: '4000', RLVN: '40'}, tape: [], memory: {}, regime});
  const momentum = decide('momentum', {balances: {USDC: '4000', RLVN: '40'}, tape: [{side: 'buy', price: 100}], memory: {}, regime});
  assert.equal(whale.side, 'sell');
  assert.equal(momentum.side, 'sell');
});

test('rally regime pushes whale to buy', () => {
  const regime = {id: 'rally', bias: 1, buyProb: 1};
  const whale = decide('whale', {balances: {USDC: '4000', RLVN: '40'}, tape: [], memory: {}, regime});
  assert.equal(whale.side, 'buy');
});

test('no strategy dumps a large clip in one fill', () => {
  const balances = {USDC: '8000', RLVN: '80'};
  for (const id of STRATEGY_IDS) {
    const decision = decide(id, {balances, tape: [{side: 'buy', price: 100}], memory: {}});
    if (decision.skip) continue;
    if (decision.side === 'buy') assert.ok(decision.amountIn <= 100, id + ' ' + decision.amountIn);
    else assert.ok(decision.amountIn <= 1, id + ' ' + decision.amountIn);
    assert.ok(decision.waitMs >= 16_000, id + ' wait ' + decision.waitMs);
  }
});
