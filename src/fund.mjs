import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {
  SYSTEM_PROGRAM, createChainRpc, loadKeypair, sendIx, u64le
} from '../../rillvane/backend/chain.mjs';
import {KEYS_DIR, RPC_URL, SOL_FUND_LAMPORTS} from './config.mjs';
import {log} from './log.mjs';

function transferSol(from, to, lamports) {
  return {
    programId: SYSTEM_PROGRAM,
    accounts: [
      {pubkey: from, isSigner: true, isWritable: true},
      {pubkey: to, isSigner: false, isWritable: true}
    ],
    data: Buffer.concat([Buffer.from([2, 0, 0, 0]), u64le(lamports)])
  };
}

export async function fundWallets(accounts) {
  const deployerPath = join(KEYS_DIR, 'deployer.json');
  if (!existsSync(deployerPath)) throw new Error('Missing deployer key at ' + deployerPath);
  const deployer = loadKeypair(deployerPath);
  const rpc = createChainRpc(RPC_URL);
  const deployerBal = await rpc.call('getBalance', [deployer.publicKey, {commitment: 'confirmed'}]);
  const needed = [];
  for (const account of accounts) {
    const info = await rpc.call('getBalance', [account.publicKey, {commitment: 'confirmed'}]);
    const lamports = BigInt(info.value || 0);
    if (lamports < SOL_FUND_LAMPORTS / 2n) needed.push(account);
    log({event: 'sol.balance', account: account.id, wallet: account.publicKey, lamports: lamports.toString()});
  }
  if (!needed.length) return {funded: 0, deployer: deployer.publicKey};
  const total = SOL_FUND_LAMPORTS * BigInt(needed.length);
  if (BigInt(deployerBal.value || 0) < total + 20_000_000n) {
    throw new Error(
      'Deployer needs more devnet SOL to fund bots. Send SOL to ' + deployer.publicKey +
      ' via https://faucet.solana.com (need ~' + Number(total) / 1e9 + ' SOL).'
    );
  }
  const sent = await sendIx(rpc, {
    feePayer: deployer,
    signers: [deployer],
    instructions: needed.map(account => transferSol(deployer.publicKey, account.publicKey, SOL_FUND_LAMPORTS))
  });
  log({event: 'sol.funded', count: needed.length, signature: sent.signature, explorer: 'https://explorer.solana.com/tx/' + sent.signature + '?cluster=devnet'});
  return {funded: needed.length, signature: sent.signature, deployer: deployer.publicKey};
}
