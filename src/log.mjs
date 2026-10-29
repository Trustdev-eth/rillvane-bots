import {mkdirSync, appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {LOG_DIR} from './config.mjs';

mkdirSync(LOG_DIR, {recursive: true});
const file = join(LOG_DIR, 'bots.log');

export function log(entry) {
  const row = {time: new Date().toISOString(), ...entry};
  const line = JSON.stringify(row);
  process.stdout.write(line + '\n');
  try { appendFileSync(file, line + '\n'); } catch {}
}
