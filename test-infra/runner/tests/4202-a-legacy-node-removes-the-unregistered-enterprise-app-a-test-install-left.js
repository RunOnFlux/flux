// upgrades-from: v8.23.0
// weight: medium
import {
  describe, it, before, after,
} from 'mocha';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildAppSpec, buildAppMessage } from '../framework/app-helper.js';
import { buildEnterpriseBlob } from '../framework/enterprise-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { appOwnerKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { execInContainer } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { upgradeBase } from '../framework/upgrade-base.js';

// A legacy node removes, at the first start of this build, an installed
// enterprise app that was never registered, and keeps every other app it holds.
//
// The legacy node starts on the release it upgrades from. A peer relays an
// unpaid enterprise registration whose blob encrypts its compose and which also
// carries that compose in plain; that release stores it, and its owner's test
// install leaves the app installed, with its container, on the node. A seeded
// app on the same node is the one it keeps.

const { tag: BASE_TAG } = upgradeBase(fileURLToPath(import.meta.url));
const ARCANE = 0;
const LEGACY = 1;
const REAL_NODES = 2;
const STUB_INDEX = 2;

function appComponent(appName) {
  return {
    name: 'alpha',
    description: 'kept across the upgrade',
    repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
    ports: [],
    domains: [''],
    environmentParameters: [],
    commands: [],
    containerPorts: [80],
    containerData: '/tmp',
    cpu: 0.1,
    ram: 100,
    hdd: 1,
    repoauth: '',
  };
}

describe('a legacy node removes the unregistered enterprise app a test install left', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let stub;
  const stamp = Date.now();
  const leftName = `e2eentleft${stamp}`;
  const keptName = `e2eentkept${stamp}`;
  const legacy = () => env.clients[LEGACY];
  const containerNames = async () => {
    const listed = await execInContainer(legacy().container, 'docker ps -a --format "{{.Names}}"');
    if (listed.exitCode !== 0) throw new Error(`could not list the node's containers: ${listed.output}`);
    return listed.output;
  };
  let upgradedAfter;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: REAL_NODES + 1,
      legacyNodes: [LEGACY],
      stubPeers: [STUB_INDEX],
      tickerAutostart: false,
      nodeImageTags: { [LEGACY]: BASE_TAG },
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    stub = env.stubPeerClients.get(STUB_INDEX);
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    expect(await stub.connectedNodes(), 'fixture: the stub reaches both nodes').to.equal(REAL_NODES);

    await pushImage(keptName, 'v1');
    await installOnNodes(env, await buildSeedableApp({ name: keptName, instances: 1, compose: [appComponent(keptName)] }), [LEGACY]);

    const plain = buildAppSpec({ name: leftName });
    const message = await buildAppMessage({ ...plain, enterprise: buildEnterpriseBlob(plain.compose, plain.contacts) });
    await stub.broadcast(message);
    await waitFor(async () => (await legacy().getTempMessages(message.hash)).data?.length > 0, {
      timeout: 60000, interval: 2000, label: 'the legacy node holds the message',
    });
    const { zelidauth } = await authenticate(legacy().url, appOwnerKey());
    await legacy().testAppInstall(message.hash, zelidauth);

    const left = await dbClient(LEGACY + 1).localApp(leftName);
    expect(left, 'fixture: the test install left no app on the node').to.not.equal(null);
    expect(left.enterprise, 'fixture: the app left is not enterprise').to.be.a('string').and.not.equal('');
    expect(left.height, 'fixture: the app left has a height').to.equal(undefined);
    expect(await containerNames(), 'fixture: the test install left no container').to.include(`_${leftName}`);

    upgradedAfter = legacy().getLastEventId();
    await env.upgradeNode(LEGACY, { tag: env.nodeImageTag(ARCANE) });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('removes the app, its row and its container', async function () {
    this.timeout(300000);
    await legacy().waitForEvent('app:removed', (d) => d.name === leftName, 240000, { afterId: upgradedAfter });

    expect(await dbClient(LEGACY + 1).localApp(leftName), 'the row is still on the node').to.equal(null);
    expect(await containerNames(), 'a container of the app is still on the node').to.not.include(`_${leftName}`);
  });

  it('keeps the app it holds that was registered', async function () {
    this.timeout(60000);
    expect(await dbClient(LEGACY + 1).localApp(keptName), 'the registered app was removed').to.not.equal(null);
    expect(await containerNames(), 'the registered app\'s container was removed').to.include(`_${keptName}`);
  });
});
