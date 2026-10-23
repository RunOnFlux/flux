// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { resetSyncState, pinColdStart, pinHolding } from '../framework/syncthing-control.js';
import { resetFdm } from '../framework/fdm-control.js';
import { failRpc, clearRpcFailures } from '../framework/daemon-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { buildSeedableEnterpriseApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { crashFluxos, releaseFluxos } from '../framework/container.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Cold starts of an enterprise g: app where a holder comes back from a restart unable
// to decrypt the app's spec: the benchmark refuses it the key. Its monitor pass does
// not reach the app's folder, so what it holds is unknown.
//
// It is left out of the choice: a holder with data seeds, and while no other holder
// has data nobody seeds until it can decrypt again. Once it can, it measures the
// folder and the seed goes ahead.
//
// Every other holder is held before it measures until each broken holder answers its
// peers again, so the decisions under test are made with the broken holders' answers.

const subnet = getSubnetConfig();
const APP_UID = 1000;
const COMPONENT = 'data';
const BEFORE_HOLDINGS = 'syncthing:beforeHoldings';
const SETTLE_PASSES = 6;
const DATA_BYTES = 5821604997;
const DECRYPT = 'decryptrsamessage';
const nodeIp = (i) => subnet.nodeIp(i + 1);

describe('a holder that cannot decrypt an app\'s spec is left out of the seed', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const client = (i) => env.clients[i];

  // One app per case, on its own two holders, decided from a cold start.
  function coldStartCase(tag, { lowest, other, broken, dataOn }) {
    const holders = [lowest, other];
    const appName = `e2enodecrypt${tag}${Date.now()}`;
    const watch = watchGComponents(() => env, { appName, components: [COMPONENT], holders });
    const folder = watch.folderOf(COMPONENT);
    const count = (i, counter, decision) => client(i).getDecisionCount(counter, folder, decision);
    const decider = holders.find((i) => i !== broken);
    const seeded = (i) => count(i, 'syncthing:seedDecision', 'seeded');

    return {
      folder,
      decider,
      oneHolderAtMost: watch.oneHolderAtMost,
      seeded,
      cannotSeed: (i) => count(i, 'syncthing:seedDecision', 'holderCannotSeed'),
      waitedOnVolume: (i) => count(i, 'syncthing:seedDecision', 'holderVolumeHeldOut'),
      passes: (i) => count(i, 'syncthing:folderPass', 'evaluated'),
      seeders: async () => (await Promise.all(holders.map(seeded))).map((n, k) => (n > 0 ? holders[k] : null)).filter((i) => i !== null),

      async start() {
        expect(nodeIp(lowest) < nodeIp(other), 'fixture: the lowest holder is not the lowest address').to.equal(true);
        await pushTestApp(appName, 'v1', 'nodecrypt', { user: APP_UID });
        const app = await buildSeedableEnterpriseApp({
          env, name: appName, instances: holders.length, compose: [gComponent(appName, COMPONENT)],
        });
        await pinColdStart(holders, folder);
        if (dataOn !== undefined) await pinHolding(dataOn, folder, DATA_BYTES);
        const from = client(decider).getLastEventId();
        await client(decider).holdCheckpoint(BEFORE_HOLDINGS, folder);
        await installOnNodes(env, app, holders);
        await client(decider).waitForEvent(
          'checkpoint:held',
          (d) => d.name === BEFORE_HOLDINGS && d.key === folder,
          300000,
          { afterId: from },
        );

        await crashFluxos(client(broken).container, { hold: true });
        await failRpc(nodeIp(broken), DECRYPT, { times: 1000000 });
        await releaseFluxos(client(broken).container);
        await waitFor(async () => (await client(broken).getPromotedFolders())?.data?.ready === true, {
          timeout: 300000, interval: 2000, label: `node ${broken} answers its peers after its restart`,
        });
        await client(decider).releaseCheckpoint(BEFORE_HOLDINGS, folder);
      },

      // Until `done`, or SETTLE_PASSES folder passes go by on the decider; never more
      // than one holder running the app.
      async settle(done, label) {
        const from = await this.passes(decider);
        await waitHolding(async () => {
          await watch.oneHolderAtMost();
          return await done() || await this.passes(decider) >= from + SETTLE_PASSES;
        }, { timeout: 300000, interval: 2000, label });
      },
    };
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 4, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();
  });

  after(async function () {
    this.timeout(60000);
    await Promise.all((env?.clients ?? []).map((c) => c?.releaseAllCheckpoints().catch(() => {})));
    await Promise.all([0, 1, 2, 3].map((i) => clearRpcFailures(nodeIp(i)).catch(() => {})));
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  describe('the lowest address cannot decrypt the spec, and another holder has data', () => {
    const c = {};
    before(() => Object.assign(c, coldStartCase('data', {
      lowest: 0, other: 1, broken: 0, dataOn: 1,
    })));

    it('seeds on the holder with data', async function () {
      this.timeout(900000);
      await c.start();
      await c.settle(async () => await c.seeded(1) >= 1, 'the holder with data seeds, or the passes go by without it');

      expect(await c.seeded(1), `the holder with data did not seed in ${SETTLE_PASSES} passes`).to.be.at.least(1);
      expect(await c.seeded(0), 'the holder that cannot decrypt seeded').to.equal(0);
    });

    it('takes the holder back as a standby once it can decrypt', async function () {
      this.timeout(600000);
      const from = await c.passes(0);
      await clearRpcFailures(nodeIp(0));
      await waitHolding(async () => {
        await c.oneHolderAtMost();
        return await c.passes(0) >= from + SETTLE_PASSES;
      }, { timeout: 300000, interval: 2000, label: `the holder that can decrypt again passes its folder ${SETTLE_PASSES} times` });

      expect(await c.seeders(), 'the holders that seeded').to.deep.equal([1]);
    });
  });

  describe('a holder that cannot decrypt the spec may hold the data, and the lowest address has none', () => {
    const c = {};
    before(() => Object.assign(c, coldStartCase('wait', {
      lowest: 2, other: 3, broken: 3, dataOn: 3,
    })));

    it('seeds nothing while that holder cannot decrypt', async function () {
      this.timeout(900000);
      await c.start();
      await c.settle(async () => await c.seeded(2) >= 1, 'the lowest address seeds, or the passes go by without it');

      expect(await c.seeded(2), 'an empty copy seeded over a folder that may hold the app\'s data').to.equal(0);
      expect(await c.waitedOnVolume(2), 'the lowest address never waited on the holder that cannot decrypt').to.be.at.least(1);
      expect(await c.seeded(3), 'the holder that cannot decrypt seeded').to.equal(0);
    });

    it('seeds on the holder with data once it can decrypt', async function () {
      this.timeout(600000);
      await clearRpcFailures(nodeIp(3));
      await waitHolding(async () => {
        await c.oneHolderAtMost();
        return (await c.seeders()).length >= 1;
      }, { timeout: 300000, interval: 2000, label: 'a holder seeds once the spec can be decrypted' });

      expect(await c.seeders(), 'the holders that seeded').to.deep.equal([3]);
    });
  });
});
