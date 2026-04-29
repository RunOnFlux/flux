import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/ripemd160.js';
import bs58check from 'bs58check';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const keysDir = join(__dirname, 'keys');
mkdirSync(keysDir, { recursive: true });

function generateKeypair(label) {
  const privKeyBytes = randomBytes(32);
  const pubKeyBytes = secp256k1.getPublicKey(privKeyBytes, true);

  const sha = sha256(pubKeyBytes);
  const h160 = ripemd160(sha);

  const addrPayload = Buffer.concat([Buffer.from([0x00]), Buffer.from(h160)]);
  const zelid = bs58check.encode(addrPayload);

  // WIF: 0x80 + privkey + 0x01 (compressed) → base58check
  const wifPayload = Buffer.concat([Buffer.from([0x80]), privKeyBytes, Buffer.from([0x01])]);
  const wif = bs58check.encode(wifPayload);

  return {
    label,
    privkey: Buffer.from(privKeyBytes).toString('hex'),
    pubkey: Buffer.from(pubKeyBytes).toString('hex'),
    wif,
    zelid,
  };
}

const NODE_COUNT = 16;
const tiers = [
  'CUMULUS', 'CUMULUS', 'CUMULUS', 'CUMULUS',
  'NIMBUS', 'NIMBUS', 'NIMBUS', 'NIMBUS',
  'NIMBUS', 'NIMBUS',
  'STRATUS', 'STRATUS', 'STRATUS', 'STRATUS',
  'STRATUS', 'CUMULUS',
];
const regions = [
  'EU_DE', 'EU_DE', 'EU_FR', 'EU_CZ',
  'US_NY', 'US_NY', 'US_CA', 'US_TX',
  'US_VA', 'US_VA',
  'AS_SG', 'AS_SG', 'AS_JP',
  'EU_DE', 'US_CA', 'EU_FR',
];
const staticIps = [
  true, false, true, true,
  true, true, true, false,
  true, true,
  true, true, true,
  true, true, true,
];

const nodes = [];
for (let i = 0; i < NODE_COUNT; i++) {
  const num = String(i + 1).padStart(2, '0');
  const kp = generateKeypair(`node-${num}`);
  const txhash = Buffer.from(randomBytes(32)).toString('hex');

  nodes.push({
    ...kp,
    index: i,
    tier: tiers[i],
    region: regions[i],
    staticIp: staticIps[i],
    txhash,
    outidx: '0',
    ip: `10.10.${i + 1}.0:16127`,
  });

  writeFileSync(join(keysDir, `node-${num}.json`), JSON.stringify(kp, null, 2) + '\n');
}

const appOwner = generateKeypair('app-owner');
writeFileSync(join(keysDir, 'app-owner.json'), JSON.stringify(appOwner, null, 2) + '\n');

const deterministicList = nodes.map((n) => ({
  collateral: `COutPoint(${n.txhash}, ${n.outidx})`,
  txhash: n.txhash,
  outidx: n.outidx,
  ip: n.ip,
  network: '',
  added_height: 2090000,
  confirmed_height: 2090500,
  last_confirmed_height: 2099990,
  last_paid_height: 2099900,
  tier: n.tier,
  payment_address: n.zelid,
  pubkey: n.pubkey,
  activesince: Math.floor(Date.now() / 1000) - 86400 * 30,
  lastpaid: Math.floor(Date.now() / 1000) - 3600,
  rank: n.index + 1,
}));

writeFileSync(
  join(__dirname, 'deterministic-list.json'),
  JSON.stringify(deterministicList, null, 2) + '\n',
);

const nodeManifest = nodes.map((n) => ({
  label: n.label,
  ip: n.ip,
  zelid: n.zelid,
  pubkey: n.pubkey,
  tier: n.tier,
  region: n.region,
  staticIp: n.staticIp,
  txhash: n.txhash,
}));

writeFileSync(
  join(__dirname, 'node-manifest.json'),
  JSON.stringify({ nodes: nodeManifest, appOwner: { zelid: appOwner.zelid } }, null, 2) + '\n',
);

// Per-node flux.conf files
const confDir = join(__dirname, 'conf');
mkdirSync(confDir, { recursive: true });
for (const n of nodes) {
  const num = String(n.index + 1).padStart(2, '0');
  const conf = `rpcuser=fluxtest\nrpcpassword=fluxtest\nrpcport=16124\nrpcallowip=0.0.0.0/0\nzelnodeprivkey=${n.wif}\n`;
  writeFileSync(join(confDir, `flux-${num}.conf`), conf);
}

console.log(`Generated ${NODE_COUNT} node keypairs + app-owner keypair`);
console.log(`  keys/node-01.json .. keys/node-${String(NODE_COUNT).padStart(2, '0')}.json`);
console.log(`  keys/app-owner.json`);
console.log(`  deterministic-list.json`);
console.log(`  node-manifest.json`);
