import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey, fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { buildAppSpec, registerApp, registerAndConfirm } from '../framework/app-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  crashFluxos, getAppContainerStatus, releaseFluxos, restartFluxos,
} from '../framework/container.js';
import {
  advanceBlock, getState, queueAppTx, startTicker, stopTicker,
} from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { waitFor, waitForInstallSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A restarting node rebuilds its application registry once its boot hash sync
// completes, and refills its location store from the orchestrator's state sync.
// Until each stands, the routes a director reads the network from answer 503
// with a Retry-After, and once it stands they answer the whole of it. There is
// no third answer: never a 200 carrying an empty or partial list, which a
// caller such as FDM cannot tell from a network with fewer apps.
//
// Driven by restartFluxos, which kills only the FluxOS process and leaves mongo
// and the registry exactly where the node left them - the `systemctl restart
// fluxos` an operator performs, and the path that runs the boot rebuild.

const NODES = 4;
const APPS = 3;
const RESTARTED = 0;
const POLL_MS = 200;

describe('registry and location reads wait for their store after a restart', function () {
  let env;
  const appNames = [];

  dumpLogsOnFailure(() => env);

  // One read, with the status the node answered and the length of any list.
  const read = async (path) => {
    const res = await fetch(`${env.clients[RESTARTED].url}${path}`);
    const body = await res.json().catch(() => null);
    return {
      status: res.status,
      // FluxOS reports a handler's own failure as a 200 whose body says error; a
      // caller acts only on a body that says success.
      success: res.status === 200 && body?.status === 'success',
      retryAfter: res.headers.get('retry-after'),
      listed: Array.isArray(body?.data) ? body.data.length : null,
      names: Array.isArray(body?.data) ? body.data.map((a) => a.name) : [],
    };
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await bootAndPeer(env);
    for (let i = 0; i < APPS; i += 1) {
      const name = `e2eregistrywait${i}${Date.now()}`;
      // eslint-disable-next-line no-await-in-loop
      const result = await registerAndConfirm(env.clients[0].url, nodeKey(1), buildAppSpec({ name }), env.clients);
      expect(result.status, JSON.stringify(result)).to.equal('success');
      appNames.push(name);
    }
    await waitFor(async () => {
      const r = await read('/apps/globalappsspecifications');
      return r.status === 200 && appNames.every((n) => r.names.includes(n));
    }, { timeout: 180000, interval: 3000, label: 'every app in the restarted node\'s registry before the restart' });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  // Both routes are sampled together from the moment the node is back, so each
  // one's window is observed rather than assumed. No app runs in this fleet, so
  // an empty location list is a correct answer: for locations the contract is
  // the status, and for the registry it is the status and the whole list.
  it('answers 503 until each store stands, then the whole of it, and never a short list', async function () {
    this.timeout(420000);
    await restartFluxos(env.clients[RESTARTED].container);

    const registry = [];
    const locations = [];
    await waitFor(async () => {
      const [r, l] = await Promise.all([read('/apps/globalappsspecifications'), read('/apps/locations')]);
      registry.push(r);
      locations.push(l);
      return registry.some((x) => x.success) && locations.some((x) => x.success);
    }, { timeout: 360000, interval: POLL_MS, label: 'the registry and locations answering 200 again' });

    // Each window has to have been seen at all, or "never a short list" is true
    // of a poll that started after the store already stood.
    expect(registry.filter((r) => r.status === 503).length, 'a registry read landed before it stood').to.be.greaterThan(0);
    expect(locations.filter((r) => r.status === 503).length, 'a location read landed before they were synced').to.be.greaterThan(0);

    [...registry, ...locations].filter((r) => r.status === 503).forEach((r) => {
      expect(r.retryAfter, 'a refusal says when to come back').to.equal('15');
    });
    expect([...registry, ...locations].filter((r) => r.status !== 503 && r.status !== 200).map((r) => r.status))
      .to.deep.equal([]);
    registry.filter((r) => r.success).forEach((r) => {
      expect(appNames.every((n) => r.names.includes(n)), `a successful answer listed ${r.listed} apps`).to.equal(true);
    });
  });

  it('keeps answering the whole registry once it stands', async () => {
    const r = await read('/apps/globalappsspecifications');
    expect(r.success).to.equal(true);
    expect(appNames.every((n) => r.names.includes(n))).to.equal(true);
  });

  // Two apps installed on the restarted node end their term while it is down. Its boot rebuild
  // no longer lists them and queues their removal, and the registry stands from the rebuild's
  // swap: its routes answer while the second app is still installed, as removals run 5 s apart.
  describe('apps that ended while the node was down', function () {
    // An app's term, in blocks: the spawner leaves an app with under newMinBlocksAllowance (100)
    // blocks left alone, so these run only where they are installed by hand.
    const TERM = 24;
    const stamp = Date.now();
    const endedNames = [`e2eregistryended0${stamp}`, `e2eregistryended1${stamp}`];
    const node = () => env.clients[RESTARTED];
    const others = () => env.clients.map((c, i) => i).filter((i) => i !== RESTARTED);
    const installed = async (name) => (await getAppContainerStatus(node().container, name, { all: true })) !== null;
    let endHeight;

    // Past the term, plus two expiry passes (every 8 blocks) on the nodes still up.
    const EXPIRY_BUDGET = TERM + 16;
    const listedElsewhere = async () => (await Promise.all(others().flatMap((i) => endedNames.map((n) => dbClient(i + 1).globalAppSpec(n)))))
      .filter(Boolean).length;
    // Mines one block at a time, each once every other node has processed the one before, until
    // the condition holds.
    const mineUntil = async (condition, { blocks, label }) => {
      for (let mined = 0; mined < blocks; mined += 1) {
        // eslint-disable-next-line no-await-in-loop
        if (await condition()) return;
        // eslint-disable-next-line no-await-in-loop
        await advanceBlock();
        // eslint-disable-next-line no-await-in-loop
        await waitFor(async () => {
          const { currentHeight } = await getState();
          const heights = await Promise.all(others().map((i) => dbClient(i + 1).explorerHeight()));
          return heights.every((h) => h >= currentHeight);
        }, { timeout: 150000, interval: 1000, label: `every other node processes the block (${label})` });
      }
      if (!await condition()) throw new Error(`${label}: not reached within ${blocks} blocks`);
    };

    before(async function () {
      this.timeout(900000);
      await stopTicker();
      const hashes = [];
      for (const name of endedNames) {
        // eslint-disable-next-line no-await-in-loop
        const result = await registerApp(node().url, nodeKey(1), buildAppSpec({ name, instances: 1, expire: TERM }), 'fluxappregister');
        expect(result.status, JSON.stringify(result)).to.equal('success');
        hashes.push(result.data);
      }
      await waitFor(async () => {
        const held = await Promise.all(env.clients.flatMap((c) => hashes.map(async (h) => (await c.getTempMessages(h)).data?.length > 0)));
        return held.every(Boolean);
      }, { timeout: 30000, interval: 2000, label: 'both registrations relayed to every node' });
      await Promise.all(hashes.map((h) => queueAppTx(h)));
      await advanceBlock();
      await waitFor(async () => {
        const specs = await Promise.all(endedNames.map((n) => dbClient(RESTARTED + 1).globalAppSpec(n)));
        return specs.every((spec) => spec?.height);
      }, { timeout: 150000, interval: 1000, label: 'both apps registered on the restarted node' });
      const specs = await Promise.all(endedNames.map((n) => dbClient(RESTARTED + 1).globalAppSpec(n)));
      endHeight = Math.max(...specs.map((spec) => spec.height + TERM));

      const auth = await authenticate(node().url, fluxTeamKey());
      for (const name of endedNames) {
        const mark = node().getLastEventId();
        // eslint-disable-next-line no-await-in-loop
        await node().installAppLocally(name, auth.zelidauth);
        // eslint-disable-next-line no-await-in-loop
        await waitForInstallSettled(node(), name, 120000, { afterId: mark });
      }
      // Canary: both are installed here before the node goes down, so their presence after it
      // returns is this install, not an absence the probe cannot see.
      expect(await Promise.all(endedNames.map(installed))).to.deep.equal([true, true]);

      await crashFluxos(node().container, { hold: true });
      // the rest of the fleet has ended both
      await mineUntil(async () => (await getState()).currentHeight > endHeight && await listedElsewhere() === 0,
        { blocks: EXPIRY_BUDGET, label: 'both apps ended on every other node' });
    });

    after(async function () {
      this.timeout(120000);
      await releaseFluxos(node().container).catch(() => {});
      await startTicker();
    });

    it('answers the whole registry while an app it no longer lists is still installed', async function () {
      this.timeout(420000);
      await releaseFluxos(node().container);

      let answered = null;
      await waitFor(async () => {
        const r = await read('/apps/globalappsspecifications');
        if (!r.success) return false;
        // read after the answer: installed now means installed when it answered
        answered = { ...r, stillInstalled: await Promise.all(endedNames.map(installed)) };
        return true;
      }, { timeout: 360000, interval: POLL_MS, label: 'the restarted node\'s registry answering 200' });

      expect(appNames.every((n) => answered.names.includes(n)), `the answer listed ${answered.listed} apps`).to.equal(true);
      expect(endedNames.filter((n) => answered.names.includes(n)), 'an ended app listed').to.deep.equal([]);
      expect(answered.stillInstalled.some(Boolean), 'the registry answered only once every ended app was removed').to.equal(true);
    });

    it('removes both ended apps from the restarted node', async function () {
      this.timeout(300000);
      await waitFor(async () => (await Promise.all(endedNames.map(installed))).every((present) => !present),
        { timeout: 240000, interval: 2000, label: 'both ended apps removed from the restarted node' });
    });
  });
});
