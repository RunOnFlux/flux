/*
 * Storage links, end to end.
 *
 * F_S_ENV and F_S_CMD let a specification carry a URL in place of values it does
 * not want written to a public chain. Every node hosting the app dereferences
 * that URL before it starts the container, carrying its own signed identity, and
 * hands the response back as the container's environment. The address is the app
 * owner's to write, so the node decides what it may be: https, and Flux storage.
 *
 * Unit tests cover the predicate. They cannot cover what breaks the fleet. The
 * check binds at the fetch, inside container creation, so a predicate that is
 * right in isolation and wrong about a real URL stops every app carrying a link
 * from starting on every node at once. And the same rule is held to live
 * submissions only: a node replaying a message already on chain must reach the
 * verdict every other node reaches, or the fleet builds different app lists from
 * the same chain.
 *
 * So this suite asserts both directions on a real node: an allowed link is
 * fetched and lands in the container, a foreign one is refused before a request
 * is made, and a message on chain validates whatever its link says.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerApp, registerAndConfirm } from '../framework/app-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { execInContainer } from '../framework/container.js';
import { dbClient } from '../framework/db-client.js';
import { REGISTRY_REPO_HOST, STORAGE_HOST } from '../framework/subnet-config.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import {
  stageStoragePayload, stageStorageRedirect, storageUrl,
  storageRequests, resetStorageRequests,
} from '../framework/external-http-control.js';
import {
  waitFor, waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppInstalled, waitForAppSpecStored,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// What the staged payload puts into the container. Read back off the container
// itself rather than out of the stub, so what is asserted is what the node did
// with the answer and not what the stub was told to say.
const MARK = 'E2E_FROM_STORAGE=storage-answered';

function composeWith(appName, environmentParameters) {
  return [{
    name: appName,
    description: 'storage link test container',
    repotag: `${REGISTRY_REPO_HOST}/e2e-pause:v1`,
    ports: [],
    domains: [''],
    environmentParameters,
    commands: [],
    containerPorts: [80],
    containerData: '/tmp',
    cpu: 0.1,
    ram: 100,
    hdd: 1,
    repoauth: '',
  }];
}

async function bootAndPeer(env) {
  for (const client of env.clients) await waitForDaemonReady(client);
  await Promise.all(env.clients.map(
    (c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000),
  ));
  await advanceBlock();
  for (const client of env.clients) {
    await waitForBlockProcessed(client, (d) => d.height > env.initialHeight, 50000);
  }
  await env.startDiscovery();
  await env.clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);
  await env.clients[0].waitForEvent('peers:added', (d) => d.inbound >= 2, 120000);
  await startTicker();
}

async function containerEnv(container, component) {
  const { stdout } = await execInContainer(
    container,
    `docker inspect --format '{{json .Config.Env}}' flux${component}`,
  );
  return JSON.parse(stdout.trim());
}

describe('1901 a storage link addresses Flux storage or nothing', function suite() {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function hook() {
    this.timeout(360000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
  });

  after(async function hook() {
    this.timeout(30000);
    await env?.teardown();
  });

  describe('a link that addresses Flux storage', () => {
    const appName = `e2estorok${Date.now()}`;
    const component = `${appName}_${appName}`;
    const payloadName = `${appName}-env`;
    let node;

    before(async function hook() {
      this.timeout(300000);
      await stageStoragePayload(payloadName, [MARK]);
      await resetStorageRequests();

      const spec = buildAppSpec({
        name: appName,
        compose: composeWith(appName, [`F_S_ENV=${storageUrl(payloadName)}`]),
        instances: 1,
      });
      const reg = await registerAndConfirm(env.clients[0].url, nodeKey(1), spec, env.clients);
      expect(reg.status, 'a link addressing Flux storage must register').to.equal('success');

      await waitForBlockProcessed(env.clients[0], (d) => d.height >= reg.targetHeight, 60000);
      await waitForAppSpecStored(env.clients[0], appName);

      const installed = await Promise.any(
        env.clients.map((c, i) => waitForAppInstalled(c, appName, 180000).then(() => i)),
      );
      node = env.clients[installed];
    });

    it('starts the container with what storage answered', async () => {
      const vars = await containerEnv(node.container, component);
      expect(vars, 'the fetched parameters never reached the container').to.include(MARK);
    });

    it('does not leave the link itself in the container', async () => {
      const vars = await containerEnv(node.container, component);
      const links = vars.filter((v) => v.startsWith('F_S_ENV='));
      expect(links, 'the link is the address, not a value the app receives').to.deep.equal([]);
    });

    it('asks as itself, over TLS, naming the app it asks for', async () => {
      const requests = await storageRequests();
      const asked = requests.filter((r) => r.name === payloadName);
      expect(asked, 'no node fetched the link').to.not.be.empty;
      // Arriving here at all is the protocol and the host: this listener serves
      // only the storage name, and only over TLS the node had to verify.
      // The app, not the component: a storage is told which application is
      // asking, and one app's components all ask as that app.
      expect(asked[0].fluxApp).to.equal(appName);
      expect(asked[0].fluxSignature, 'the node fetched without signing as itself').to.be.a('string').and.not.empty;
      expect(asked[0].fluxMessage).to.be.a('string').and.include(storageUrl(payloadName));
    });
  });

  describe('a link that addresses anywhere else', () => {
    it('is refused at registration, and nothing is fetched', async function test() {
      this.timeout(60000);
      await resetStorageRequests();

      const appName = `e2estorbad${Date.now()}`;
      const spec = buildAppSpec({
        name: appName,
        compose: composeWith(appName, ['F_S_ENV=https://storage.runonflux.io.example.com/env']),
        instances: 1,
      });
      const res = await registerApp(env.clients[0].url, nodeKey(1), spec);

      expect(res.status, 'a host that merely ends in the storage name was accepted').to.equal('error');
      expect(res.data?.message ?? '').to.match(/storage/i);
      expect(await storageRequests(), 'a refused registration still fetched').to.be.empty;
    });

    it('is refused when it names Flux storage without TLS', async function test() {
      this.timeout(60000);
      const appName = `e2estorplain${Date.now()}`;
      const spec = buildAppSpec({
        name: appName,
        compose: composeWith(appName, [`F_S_ENV=http://${STORAGE_HOST}/env`]),
        instances: 1,
      });
      const res = await registerApp(env.clients[0].url, nodeKey(1), spec);

      expect(res.status, 'the node signs this request, so it must not make it in clear').to.equal('error');
      expect(res.data?.message ?? '').to.match(/storage/i);
    });
  });

  describe('a storage that answers a redirect', () => {
    const appName = `e2estorhop${Date.now()}`;
    const movedName = `${appName}-moved`;
    const followedName = `${appName}-followed`;

    it('is not followed, wherever it points', async function test() {
      this.timeout(300000);
      await stageStorageRedirect(movedName, storageUrl(followedName));
      await stageStoragePayload(followedName, [MARK]);
      await resetStorageRequests();

      const spec = buildAppSpec({
        name: appName,
        compose: composeWith(appName, [`F_S_ENV=${storageUrl(movedName)}`]),
        instances: 1,
      });
      const reg = await registerAndConfirm(env.clients[0].url, nodeKey(1), spec, env.clients);
      expect(reg.status).to.equal('success');
      await waitForBlockProcessed(env.clients[0], (d) => d.height >= reg.targetHeight, 60000);

      // The link is reached, which is what makes the second half meaningful: a
      // node that never asked would satisfy it for the wrong reason.
      await waitFor(
        async () => (await storageRequests()).some((r) => r.name === movedName),
        { timeout: 180000, interval: 5000, label: 'the node fetched the link it was given' },
      );

      const requests = await storageRequests();
      const followed = requests.filter((r) => r.name === followedName);
      expect(followed, 'the node let the response choose its next request').to.deep.equal([]);
    });
  });

  describe('a message already on chain', () => {
    it('validates on a node replaying it, whatever its link says', async function test() {
      this.timeout(300000);

      // Seeded on one node only: it is the message the fleet already holds, and
      // it carries a link no live submission would be allowed to make.
      const appName = `e2estorreplay${Date.now()}`;
      const app = await buildSeedableApp({
        name: appName,
        env,
        instances: 1,
        compose: composeWith(appName, ['F_S_ENV=https://legacy.example.com/env']),
      });
      const holder = dbClient(1);
      await holder.seedGlobalAppSpec(app.spec);
      await holder.seedPermanentMessage(app.permanentMessage);
      await holder.seedAppHash(app.hash, app.permanentMessage.height, true);

      // Every other node learns the hash from the chain and has to go and get
      // the message, which is the path that validates it as a replay.
      await advanceBlock(app.hash);

      // Any node but the one that was seeded: which of them picks the message up
      // is the fleet's business, but a node holding this specification without
      // having been given it can only have validated it as a replay. Read from
      // the store rather than over the API, because the store is where accepting
      // a message puts the row.
      const replayers = Array.from({ length: env.nodeCount - 1 }, (_, i) => dbClient(i + 2));
      const heldBy = async () => {
        const rows = await Promise.all(replayers.map((db) => db.globalAppSpec(appName)));
        return rows.filter(Boolean);
      };

      await waitFor(
        async () => (await heldBy()).length > 0,
        { timeout: 180000, interval: 5000, label: 'a node that was not seeded stored the spec' },
      );

      const [stored] = await heldBy();
      expect(stored.compose[0].environmentParameters)
        .to.include('F_S_ENV=https://legacy.example.com/env');
    });
  });
});
