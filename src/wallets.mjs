import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {generateKeypair, loadKeypair} from '../../rillvane/backend/chain.mjs';
import {ACCOUNTS, WALLET_DIR} from './config.mjs';

function saveKeypair(path, pair) {
  writeFileSync(path, JSON.stringify([...pair.secretKey]), {encoding: 'utf8', mode: 0o600});
}

export function loadRoster() {
  mkdirSync(WALLET_DIR, {recursive: true});
  return ACCOUNTS.map(account => {
    const path = join(WALLET_DIR, account.id + '.json');
    if (!existsSync(path)) saveKeypair(path, generateKeypair());
    const keypair = loadKeypair(path);
    return {...account, path, keypair, publicKey: keypair.publicKey, memory: {}};
  });
}
