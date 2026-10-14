import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const keysDir = join(__dirname, '..', '..', 'fixtures', 'keys');

function loadKey(name) {
  return JSON.parse(readFileSync(join(keysDir, `${name}.json`), 'utf-8'));
}

export const nodeKey = (num) => loadKey(`node-${String(num).padStart(2, '0')}`);
export const appOwnerKey = () => loadKey('app-owner');
// Owners other than appOwnerKey, for suites whose apps must belong to
// different people.
export const otherOwnerKeys = () => [loadKey('app-owner-2'), loadKey('app-owner-3')];
export const fluxTeamKey = () => loadKey('flux-team');
export const userKey = () => loadKey('user');
