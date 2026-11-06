/*
 * A component's CPU, end to end.
 *
 * A component's cpu becomes its container's CPU limit, and docker reads a limit
 * of 0 as no limit at all: a component that asks for no CPU is given every core
 * on the node it lands on. So a live submission is held to the smallest CPU
 * share, and a node never creates a container without a limit, whatever height
 * its app was registered at.
 *
 * Unit tests cover the rule and the refusal. This suite covers what they cannot:
 * that the limit a real node gives a real container is the one its cpu names,
 * and that a message already on chain is still accepted as a replay - every node
 * has to reach the verdict it reached when the message was accepted - while the
 * node that tries to run it refuses to create the container.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerApp, registerAndConfirm } from '../framework/app-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { execInContainer } from '../framework/container.js';
import { dbClient } from '../framework/db-client.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import { installingErrorsByNode } from '../framework/reconciler-suite.js';
import {
  waitFor, waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppInstalled, waitForAppSpecStored,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

function composeWith(appName, cpu) {
  return [{
    name: appName,
    description: 'cpu limit test container',
    repotag: `${REGISTRY_REPO_HOST}/e2e-pause:v1`,
    ports: [],
    domains: [''],
    environmentParameters: [],
    commands: [],
    containerPorts: [80],
    containerData: '/tmp',
    cpu,
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

async function nanoCpusOf(container, component) {
  const { stdout } = await execInContainer(
    container,
    `docker inspect --format '{{.HostConfig.NanoCpus}}' flux${component}`,
  );
  return Number(stdout.trim());
}

async function containerNamesOn(container, component) {
  const { stdout } = await execInContainer(
    container,
    `docker ps -a --format '{{.Names}}' --filter name=flux${component}`,
  );
  return stdout.split('\n').map((name) => name.trim()).filter(Boolean);
}

describe('1903 a component always runs under a CPU limit', function suite() {
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

  describe('a live submission', () => {
    it('is refused when a component asks for no cpu', async function test() {
      this.timeout(60000);
      const appName = `e2ecpuzero${Date.now()}`;
      const spec = buildAppSpec({ name: appName, compose: composeWith(appName, 0), instances: 1 });
      const res = await registerApp(env.clients[0].url, nodeKey(1), spec);

      expect(res.status, 'a component asking for no cpu was accepted').to.equal('error');
      expect(res.data?.message ?? '').to.include('must have cpu of at least 0.1');
    });

    it('is refused when a component asks for cpu that is not a whole number of shares', async function test() {
      this.timeout(60000);
      const appName = `e2ecpustep${Date.now()}`;
      const spec = buildAppSpec({ name: appName, compose: composeWith(appName, 0.15), instances: 1 });
      const res = await registerApp(env.clients[0].url, nodeKey(1), spec);

      expect(res.status, 'a component asking for part of a share was accepted').to.equal('error');
      expect(res.data?.message ?? '').to.include('must have cpu in steps of 0.1');
    });

    it('runs a component at the smallest share under the limit its cpu names', async function test() {
      this.timeout(300000);
      const appName = `e2ecpumin${Date.now()}`;
      const spec = buildAppSpec({ name: appName, compose: composeWith(appName, 0.1), instances: 1 });
      const reg = await registerAndConfirm(env.clients[0].url, nodeKey(1), spec, env.clients);
      expect(reg.status, 'a component at the smallest cpu share must register').to.equal('success');

      await waitForBlockProcessed(env.clients[0], (d) => d.height >= reg.targetHeight, 60000);
      await waitForAppSpecStored(env.clients[0], appName);

      const installed = await Promise.any(
        env.clients.map((c, i) => waitForAppInstalled(c, appName, 180000).then(() => i)),
      );
      const nanoCpus = await nanoCpusOf(env.clients[installed].container, `${appName}_${appName}`);
      expect(nanoCpus, 'the container was not limited to the cpu its spec names').to.equal(100000000);
    });
  });

  describe('a message already on chain that asks for no cpu', () => {
    const appName = `e2ecpureplay${Date.now()}`;
    const component = `${appName}_${appName}`;

    before(async function hook() {
      this.timeout(60000);
      // Seeded on one node only: it is the message the fleet already holds, and
      // it carries a cpu no live submission would be allowed to ask for.
      const app = await buildSeedableApp({
        name: appName,
        env,
        instances: 1,
        compose: composeWith(appName, 0),
      });
      const holder = dbClient(1);
      await holder.seedGlobalAppSpec(app.spec);
      await holder.seedPermanentMessage(app.permanentMessage);
      await holder.seedAppHash(app.hash, app.permanentMessage.height, true);

      // Every other node learns the hash from the chain and has to go and get
      // the message, which is the path that validates it as a replay.
      await advanceBlock(app.hash);
    });

    it('validates on a node replaying it', async function test() {
      this.timeout(240000);
      // A node holding this specification without having been given it can only
      // have validated it as a replay. Read from the store, where accepting a
      // message puts the row.
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
      expect(stored.compose[0].cpu).to.equal(0);
    });

    it('is refused at container creation by the node that tries to run it', async function test() {
      this.timeout(300000);
      // The installing error is what makes the absence below mean something: a
      // node that never tried to run the app would hold no container either.
      const refusals = async () => (await installingErrorsByNode(env, appName))
        .flatMap((entries) => entries ?? [])
        .filter((entry) => /is not a limit/.test(entry.error ?? ''));

      await waitFor(
        async () => (await refusals()).length > 0,
        { timeout: 240000, interval: 5000, label: 'a node tried to run the app and refused its container' },
      );

      const containers = await Promise.all(env.clients.map((c) => containerNamesOn(c.container, component)));
      expect(containers.flat(), 'a node created a container with no CPU limit').to.deep.equal([]);
    });
  });
});
