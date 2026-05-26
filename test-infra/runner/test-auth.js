import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

const NODE_BASE_URL = process.env.NODE_URL || 'http://198.18.1.0:16127';

const keypair = JSON.parse(readFileSync(join(fixturesDir, 'keys', 'node-01.json'), 'utf-8'));

console.log(`Authenticating as ${keypair.zelid} against ${NODE_BASE_URL}...`);

try {
  const auth = await authenticate(NODE_BASE_URL, keypair);
  console.log('Authentication successful!');
  console.log(`  zelid: ${auth.zelid}`);
  console.log(`  loginPhrase: ${auth.loginPhrase.substring(0, 30)}...`);
  console.log(`  signature: ${auth.signature.substring(0, 30)}...`);
  console.log(`  zelidauth header length: ${auth.zelidauth.length} chars`);
} catch (e) {
  console.error('Authentication failed:', e.message);
  process.exit(1);
}
