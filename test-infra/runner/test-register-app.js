import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate, signBtcMessage } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

const NODE_URL = process.env.NODE_URL || 'http://198.18.1.0:16127';
const NODE_COUNT = 16;

const nodeKeypair = JSON.parse(readFileSync(join(fixturesDir, 'keys', 'node-01.json'), 'utf-8'));
const appOwner = JSON.parse(readFileSync(join(fixturesDir, 'keys', 'app-owner.json'), 'utf-8'));

const appSpec = {
  version: 8,
  name: 'e2eTestApp',
  description: 'E2E test application for lifecycle testing',
  owner: appOwner.zelid,
  compose: [
    {
      name: 'e2eTestApp',
      description: 'nginx test container',
      repotag: 'nginx:alpine',
      ports: [31111],
      domains: [''],
      environmentParameters: [],
      commands: [],
      containerPorts: [80],
      containerData: '/tmp',
      cpu: 0.1,
      ram: 100,
      hdd: 1,
      repoauth: '',
    },
  ],
  instances: 3,
  contacts: [],
  geolocation: [],
  expire: 22000,
  nodes: [],
  staticip: false,
  enterprise: '',
};

async function main() {
  console.log('=== Step 1: Authenticate ===');
  const auth = await authenticate(NODE_URL, nodeKeypair);
  console.log(`Authenticated as ${auth.zelid}`);

  console.log('\n=== Step 2: Sign app spec ===');
  const timestamp = Date.now();
  const type = 'fluxappregister';
  const version = 1;
  const signaturePayload = type + version + JSON.stringify(appSpec) + timestamp;
  const signature = await signBtcMessage(signaturePayload, appOwner.privkey);
  console.log(`Spec signed by app owner ${appOwner.zelid}`);

  console.log('\n=== Step 3: Register app ===');
  const registerBody = {
    type,
    version,
    appSpecification: appSpec,
    timestamp,
    signature,
  };

  const registerRes = await fetch(`${NODE_URL}/apps/appregister`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      zelidauth: auth.zelidauth,
    },
    body: JSON.stringify(registerBody),
  });

  const registerData = await registerRes.json();
  console.log('Register response:', JSON.stringify(registerData, null, 2));

  if (registerData.status !== 'success') {
    console.error('Registration failed!');
    process.exit(1);
  }

  console.log('\n=== Step 4: Check propagation ===');
  console.log('Waiting 30s for message propagation...');
  await new Promise((r) => setTimeout(r, 30000));

  let nodesWithSpec = 0;
  for (let i = 1; i <= NODE_COUNT; i++) {
    const num = String(i).padStart(2, '0');
    const nodeIp = `198.18.${i}.0`;
    try {
      const res = await fetch(`http://${nodeIp}:16127/apps/appspecifications/e2eTestApp`);
      const data = await res.json();
      if (data.status === 'success' && data.data) {
        nodesWithSpec++;
      }
    } catch {
      // node unreachable
    }
  }

  console.log(`App spec propagated to ${nodesWithSpec}/${NODE_COUNT} nodes`);

  if (nodesWithSpec === NODE_COUNT) {
    console.log('\nFull propagation confirmed!');
  } else if (nodesWithSpec > 0) {
    console.log('\nPartial propagation — some nodes may need more time');
  } else {
    console.log('\nNo propagation detected — check logs');
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
