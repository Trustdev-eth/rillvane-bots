import {ACCOUNTS, ORIGIN, REMOTE_ORIGIN, SEED_CHART} from './config.mjs';
import {fundWallets} from './fund.mjs';
import {log} from './log.mjs';
import {createDirector, runDirector} from './market.mjs';
import {originHealth, OriginSession} from './origin.mjs';
import {seedChart} from './seed-chart.mjs';
import {decide} from './strategies.mjs';
import {loadRoster} from './wallets.mjs';

const args = new Set(process.argv.slice(2));
const setupOnly = args.has('--setup-only');
const seedOnly = args.has('--seed-only');
const reseed = args.has('--reseed');
const noSeed = args.has('--no-seed');
const once = args.has('--once');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function usage() {
  process.stdout.write(`Rillvane devnet trading bots

  node src/run.mjs              create accounts, fund, faucet, seed chart, trade
  node src/run.mjs --setup-only wallets, SOL, faucet, seed; then exit
  node src/run.mjs --seed-only  write historical candles into origin sqlite
  node src/run.mjs --reseed     rebuild candle history and restart the live tape
  node src/run.mjs --no-seed    skip chart history
  node src/run.mjs --once       one trade per account, then exit

Origin ${ORIGIN}
Accounts: ${ACCOUNTS.map(a => a.id + '/' + a.strategy).join(', ')}
`);
}

async function claimFaucet(session, asset, amount) {
  const status = await session.faucetStatus();
  const remaining = Number(status[asset]?.remaining || 0);
  if (remaining < 1) return null;
  const claim = Math.min(amount, remaining);
  return session.faucet(asset, String(claim));
}

async function setupAccount(account) {
  account.session = new OriginSession({keypair: account.keypair});
  await account.session.login();
  const usdc = await claimFaucet(account.session, 'USDC', 10000);
  const rlvn = await claimFaucet(account.session, 'RLVN', 100);
  const portfolio = await account.session.portfolio();
  log({
    event: 'account.ready',
    account: account.id,
    strategy: account.strategy,
    wallet: account.publicKey,
    usdc: portfolio.balances.USDC,
    rlvn: portfolio.balances.RLVN,
    faucet: {usdc: Boolean(usdc), rlvn: Boolean(rlvn)}
  });
  return portfolio;
}

async function tradeOnce(account, tape, director) {
  const portfolio = await account.session.ensureSession();
  const decision = decide(account.strategy, {
    balances: portfolio.balances,
    tape,
    memory: account.memory,
    regime: director.state.phase,
    price: director.state.price
  });
  if (decision.skip) {
    log({event: 'trade.skip', account: account.id, reason: 'inventory'});
    return decision.waitMs || 12000;
  }
  const result = await account.session.swap({side: decision.side, amountIn: decision.amountIn});
  const price = Number(result.event?.execPrice || 0);
  tape.push({side: decision.side, price, time: Date.now(), account: account.id, amountIn: decision.amountIn});
  if (tape.length > 100) tape.splice(0, tape.length - 80);
  log({
    event: 'trade.ok',
    account: account.id,
    strategy: account.strategy,
    side: decision.side,
    amountIn: decision.amountIn,
    price,
    out: result.event?.amountOut,
    usdc: result.portfolio?.balances?.USDC,
    rlvn: result.portfolio?.balances?.RLVN
  });
  return decision.waitMs || 12000;
}

async function runAccount(account, tape, stop, director, index = 0) {
  let delay = 12_000 + index * 4_000 + Math.floor(Math.random() * 8_000);
  while (!stop.flag) {
    await sleep(delay);
    if (stop.flag) break;
    try {
      delay = await tradeOnce(account, tape, director);
    } catch (error) {
      const wait = error.status === 429 ? Math.max(16_000, (error.retryAfter || 8) * 1000) : error.status === 401 ? 1000 : 12_000;
      log({event: 'trade.err', account: account.id, status: error.status, code: error.code, error: error.message});
      if (error.status === 401) {
        try { await account.session.login(); } catch (authError) {
          log({event: 'auth.err', account: account.id, error: authError.message});
        }
      }
      delay = wait;
    }
    if (once) break;
  }
}

async function main() {
  if (args.has('--help') || args.has('-h')) {
    usage();
    return;
  }
  log({event: 'bot.start', origin: ORIGIN, setupOnly, seedOnly, reseed, once, remote: REMOTE_ORIGIN});
  await originHealth();
  if (REMOTE_ORIGIN) {
    log({event: 'seed.skip', reason: 'remote-origin-has-no-local-sqlite'});
  } else if (reseed) seedChart({replace: true});
  else if (SEED_CHART && !noSeed) seedChart();
  if (seedOnly) return;

  const roster = loadRoster();
  for (const account of roster) log({event: 'wallet', account: account.id, strategy: account.strategy, wallet: account.publicKey});
  await fundWallets(roster);
  for (const account of roster) await setupAccount(account);
  if (setupOnly) return;

  const tape = [];
  const stop = {flag: false};
  const director = createDirector();
  const halt = () => { stop.flag = true; };
  process.once('SIGINT', halt);
  process.once('SIGTERM', halt);
  log({event: 'bot.loop', accounts: roster.length, phase: director.state.phase.id, price: director.state.price});
  await Promise.all([
    runDirector(director, stop),
    ...roster.map((account, index) => runAccount(account, tape, stop, director, index))
  ]);
  log({event: 'bot.stop', trades: tape.length});
}

main().catch(error => {
  log({event: 'bot.fatal', error: error.message});
  process.exitCode = 1;
});
