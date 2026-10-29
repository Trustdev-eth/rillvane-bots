function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pick(min, max) {
  return min + Math.random() * (max - min);
}

function round(value, digits) {
  const f = 10 ** digits;
  return Math.max(0, Math.round(value * f) / f);
}

function lastSide(tape) {
  return tape.at(-1)?.side || (Math.random() < 0.5 ? 'buy' : 'sell');
}

function majoritySide(tape, n = 5) {
  const slice = tape.slice(-n);
  if (!slice.length) return lastSide(tape);
  const buys = slice.filter(t => t.side === 'buy').length;
  return buys >= slice.length / 2 ? 'buy' : 'sell';
}

function clip(side, want, balances) {
  if (side === 'buy') return round(Math.min(want, Math.max(0, num(balances.USDC) - 2)), 2);
  return round(Math.min(want, Math.max(0, num(balances.RLVN) - 0.02)), 4);
}

function wait(min, max) {
  return Math.round(pick(min, max));
}

function coin(p) {
  return Math.random() < p;
}

function regimeSide(ctx, fallback) {
  const p = ctx.regime?.buyProb;
  if (p == null) return fallback();
  return coin(p) ? 'buy' : 'sell';
}

function active(ctx) {
  return Math.abs(ctx.regime?.bias || 0) === 1;
}

const STRATEGIES = {
  maker(ctx) {
    const usdc = num(ctx.balances.USDC);
    const rlvn = num(ctx.balances.RLVN);
    const inventory = rlvn < 20 && usdc > 40 ? 'buy' : usdc < 80 && rlvn > 0.5 ? 'sell' : null;
    const side = inventory || regimeSide(ctx, () => lastSide(ctx.tape) === 'buy' ? 'sell' : 'buy');
    const want = side === 'buy' ? pick(8, 28) : pick(0.08, 0.28);
    return {side, amountIn: clip(side, want, ctx.balances), waitMs: wait(18_000, 40_000)};
  },
  momentum(ctx) {
    const side = regimeSide(ctx, () => majoritySide(ctx.tape, 6));
    const want = side === 'buy' ? pick(12, 36) : pick(0.12, 0.36);
    return {side, amountIn: clip(side, want, ctx.balances), waitMs: wait(22_000, 48_000)};
  },
  revert(ctx) {
    const follow = regimeSide(ctx, () => lastSide(ctx.tape) === 'buy' ? 'sell' : 'buy');
    const side = active(ctx) && coin(0.55) ? follow : (lastSide(ctx.tape) === 'buy' ? 'sell' : 'buy');
    const want = side === 'buy' ? pick(10, 30) : pick(0.1, 0.3);
    return {side, amountIn: clip(side, want, ctx.balances), waitMs: wait(20_000, 46_000)};
  },
  noise(ctx) {
    const side = regimeSide(ctx, () => coin(0.5) ? 'buy' : 'sell');
    const want = side === 'buy' ? pick(5, 16) : pick(0.05, 0.16);
    return {side, amountIn: clip(side, want, ctx.balances), waitMs: wait(16_000, 38_000)};
  },
  whale(ctx) {
    const side = regimeSide(ctx, () => num(ctx.balances.USDC) > 600 ? 'buy' : 'sell');
    const want = side === 'buy' ? pick(28, 90) : pick(0.28, 0.9);
    return {side, amountIn: clip(side, want, ctx.balances), waitMs: wait(55_000, 140_000)};
  },
  twap(ctx) {
    const memory = ctx.memory;
    const phaseSide = ctx.regime?.bias > 0 ? 'buy' : ctx.regime?.bias < 0 ? 'sell' : memory.phase;
    if (!memory.remaining || (phaseSide && memory.phase !== phaseSide)) {
      memory.phase = phaseSide || (memory.phase === 'buy' ? 'sell' : 'buy');
      memory.remaining = 6 + Math.floor(Math.random() * 5);
    }
    const side = memory.phase || 'buy';
    memory.remaining -= 1;
    const want = side === 'buy' ? pick(8, 22) : pick(0.08, 0.22);
    return {side, amountIn: clip(side, want, ctx.balances), waitMs: wait(18_000, 36_000)};
  }
};

export function decide(strategy, ctx) {
  const fn = STRATEGIES[strategy];
  if (!fn) throw new Error('Unknown strategy ' + strategy);
  const decision = fn(ctx);
  const min = decision.side === 'buy' ? 1 : 0.01;
  if (!decision.amountIn || decision.amountIn < min) {
    const flipped = decision.side === 'buy' ? 'sell' : 'buy';
    const want = flipped === 'buy' ? 12 : 0.12;
    const amountIn = clip(flipped, want, ctx.balances);
    if (amountIn < (flipped === 'buy' ? 1 : 0.01)) return {skip: true, waitMs: decision.waitMs || 20_000};
    return {side: flipped, amountIn, waitMs: decision.waitMs};
  }
  return decision;
}

export const STRATEGY_IDS = Object.keys(STRATEGIES);
