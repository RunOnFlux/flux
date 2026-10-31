// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { resetSyncState, pinColdStart, pinHolding } from '../framework/syncthing-control.js';
import { resetFdm } from '../framework/fdm-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { crashFluxos, releaseFluxos } from '../framework/container.js';
import { breakFolderVolume, destroyFolderVolume, restoreFolderVolume } from '../framework/volume-fixture.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Cold starts of a g: app where a holder comes back from a restart with a volume it
// cannot mount, and its address sorts first, so the address order would give it the
// seed. It cannot seed.
//
// A holder whose volume image is still on it may hold the app's only copy: it is left
// out of the choice, a holder with data seeds, and while no other holder has data
// nobody seeds until the volume mounts. A holder whose image is gone holds nothing:
// it is left out, and the rest seed as they would without it.
//
// Every holder is held before it measures; each broken holder is restarted with its
// volume broken, and the others are let go once it has held its folder out, so the
// decisions under test are made with the broken holders' answers.

const subnet = getSubnetConfig();
const APP_UID = 1000;
const COMPONENT = 'data';
const BEFORE_HOLDINGS = 'syncthing:beforeHoldings';
const SETTLE_PASSES = 6;
const DATA_BYTES = 5821604997;
// A broken holder whose image is on it but will not mount, and one whose image is gone.
const UNMOUNTABLE = 'unmountable';
const GONE = 'gone';

describe('a holder that cannot mount its volume is left out of the seed', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const client = (i) => env.clients[i];
  const byAddress = (holders) => [...holders].sort((a, b) => (subnet.nodeIp(a + 1) < subnet.nodeIp(b + 1) ? -1 : 1));

  // One app per case, on its own holders, decided from a cold start.
  function coldStartCase(tag, { holders, broken, dataOn }) {
    const appName = `e2ecannotseed${tag}${Date.now()}`;
    const watch = watchGComponents(() => env, { appName, components: [COMPONENT], holders });
    const folder = watch.folderOf(COMPONENT);
    const count = (i, counter, decision) => client(i).getDecisionCount(counter, folder, decision);
    const brokenHolders = Object.keys(broken).map(Number);
    const deciders = holders.filter((i) => !brokenHolders.includes(i));
    const seeded = (i) => count(i, 'syncthing:seedDecision', 'seeded');

    return {
      folder,
      oneHolderAtMost: watch.oneHolderAtMost,
      seeded,
      cannotSeed: (i) => count(i, 'syncthing:seedDecision', 'holderCannotSeed'),
      waitedOnVolume: (i) => count(i, 'syncthing:seedDecision', 'holderVolumeHeldOut'),
      passes: (i) => count(i, 'syncthing:folderPass', 'evaluated'),
      heldOutPasses: async (i) => await count(i, 'syncthing:folderPass', 'mountUnsafe') + await count(i, 'syncthing:folderPass', 'volumeNotMounted'),
      seeders: async () => (await Promise.all(holders.map(seeded))).map((n, k) => (n > 0 ? holders[k] : null)).filter((i) => i !== null),

      async start() {
        expect(byAddress(holders)[0], 'fixture: a broken holder is not the lowest address').to.be.oneOf(brokenHolders);
        await pushTestApp(appName, 'v1', 'cannotseed', { user: APP_UID });
        const app = await buildSeedableApp({
          env, name: appName, instances: holders.length, compose: [gComponent(appName, COMPONENT)],
        });
        await pinColdStart(holders, folder);
        if (dataOn !== undefined) await pinHolding(dataOn, folder, DATA_BYTES);
        // Every holder is held before it measures, the broken ones too: a broken holder
        // decides nothing before its restart, so it cannot seed and start the app on the
        // volume it is about to lose. Its hold ends with its FluxOS.
        const from = Object.fromEntries(holders.map((i) => [i, client(i).getLastEventId()]));
        await Promise.all(holders.map((i) => client(i).holdCheckpoint(BEFORE_HOLDINGS, folder)));
        await installOnNodes(env, app, holders);
        await Promise.all(holders.map((i) => client(i).waitForEvent(
          'checkpoint:held',
          (d) => d.name === BEFORE_HOLDINGS && d.key === folder,
          300000,
          { afterId: from[i] },
        )));

        // eslint-disable-next-line no-restricted-syntax
        for (const i of brokenHolders) {
          // eslint-disable-next-line no-await-in-loop
          await crashFluxos(client(i).container, { hold: true });
          // eslint-disable-next-line no-await-in-loop
          if (broken[i] === GONE) await destroyFolderVolume(client(i).container, folder);
          // eslint-disable-next-line no-await-in-loop
          else await breakFolderVolume(client(i).container, folder);
          // eslint-disable-next-line no-await-in-loop
          await releaseFluxos(client(i).container);
          // eslint-disable-next-line no-await-in-loop
          await waitFor(async () => await count(i, 'syncthing:folderPass', 'mountUnsafe') >= 1, {
            timeout: 300000, interval: 2000, label: `node ${i} holds the folder out`,
          });
        }
        await Promise.all(deciders.map((i) => client(i).releaseCheckpoint(BEFORE_HOLDINGS, folder)));
      },

      // Until `done`, or SETTLE_PASSES folder passes go by on `watched`; never more than
      // one holder running the app.
      async settle(watched, done, label) {
        const from = await this.passes(watched);
        await waitHolding(async () => {
          await watch.oneHolderAtMost();
          return await done() || await this.passes(watched) >= from + SETTLE_PASSES;
        }, { timeout: 300000, interval: 2000, label });
      },
    };
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 6, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();
  });

  after(async function () {
    this.timeout(60000);
    await Promise.all((env?.clients ?? []).map((c) => c?.releaseAllCheckpoints().catch(() => {})));
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  describe('the lowest address cannot mount a volume whose image is on it, and another holder has data', () => {
    const c = {};
    before(() => Object.assign(c, coldStartCase('data', { holders: [0, 1], broken: { 0: UNMOUNTABLE }, dataOn: 1 })));

    it('seeds on the holder with data', async function () {
      this.timeout(900000);
      await c.start();
      await c.settle(1, async () => await c.seeded(1) >= 1, 'the holder with data seeds, or the passes go by without it');

      expect(await c.seeded(1), `the holder with data did not seed in ${SETTLE_PASSES} passes`).to.be.at.least(1);
      expect(await c.cannotSeed(1), 'the holder with data never left the broken holder out').to.be.at.least(1);
      expect(await c.seeded(0), 'the broken holder seeded').to.equal(0);
      expect(await c.heldOutPasses(0), 'fixture: the broken holder no longer holds the folder out').to.be.at.least(1);
    });

    it('takes the broken holder back as a standby once its volume mounts', async function () {
      this.timeout(600000);
      const from = await c.passes(0);
      await restoreFolderVolume(client(0).container, c.folder);
      await waitHolding(async () => {
        await c.oneHolderAtMost();
        return await c.passes(0) >= from + SETTLE_PASSES;
      }, { timeout: 300000, interval: 2000, label: `the restored holder passes its folder ${SETTLE_PASSES} times` });

      expect(await c.seeders(), 'the holders that seeded').to.deep.equal([1]);
    });
  });

  describe('the lowest address cannot mount a volume whose image is on it, and no other holder has data', () => {
    const c = {};
    before(() => Object.assign(c, coldStartCase('wait', { holders: [2, 3], broken: { 2: UNMOUNTABLE } })));

    it('seeds nothing while the volume will not mount', async function () {
      this.timeout(900000);
      await c.start();
      await c.settle(3, async () => await c.seeded(3) >= 1, 'the other holder seeds, or the passes go by without it');

      expect(await c.seeded(3), 'an empty copy seeded over a volume that may hold the app\'s data').to.equal(0);
      expect(await c.waitedOnVolume(3), 'the other holder never waited on the broken holder\'s volume').to.be.at.least(1);
      expect(await c.seeded(2), 'the broken holder seeded').to.equal(0);
    });

    it('seeds once that volume mounts', async function () {
      this.timeout(600000);
      await restoreFolderVolume(client(2).container, c.folder);
      await waitHolding(async () => {
        await c.oneHolderAtMost();
        return (await c.seeders()).length >= 1;
      }, { timeout: 300000, interval: 2000, label: 'a holder seeds once the volume mounts' });

      expect(await c.seeders(), 'the holders that seeded').to.have.lengthOf(1);
    });
  });

  describe('the lowest address\'s volume image is gone, and no other holder has data', () => {
    const c = {};
    before(() => Object.assign(c, coldStartCase('gone', { holders: [4, 5], broken: { 4: GONE } })));

    it('seeds on the other holder, empty', async function () {
      this.timeout(900000);
      await c.start();
      await c.settle(5, async () => await c.seeded(5) >= 1, 'the other holder seeds, or the passes go by without it');

      expect(await c.seeded(5), `the other holder did not seed in ${SETTLE_PASSES} passes`).to.be.at.least(1);
      expect(await c.cannotSeed(5), 'the other holder never left the broken holder out').to.be.at.least(1);
      expect(await c.waitedOnVolume(5), 'the other holder waited on a volume whose image is gone').to.equal(0);
      expect(await c.seeded(4), 'the broken holder seeded').to.equal(0);
    });
  });

  describe('the lowest address cannot mount, the next holds nothing, and the last has data', () => {
    const c = {};
    before(() => Object.assign(c, coldStartCase('three', { holders: [1, 3, 5], broken: { 1: UNMOUNTABLE }, dataOn: 5 })));

    it('seeds on the holder with data, not the next address', async function () {
      this.timeout(900000);
      await c.start();
      await c.settle(5, async () => await c.seeded(5) >= 1, 'the holder with data seeds, or the passes go by without it');

      expect(await c.seeders(), 'the holders that seeded').to.deep.equal([5]);
    });
  });

  describe('two holders cannot mount, one with its image and one without, and the last has data', () => {
    const c = {};
    before(() => Object.assign(c, coldStartCase('two', { holders: [0, 2, 4], broken: { 0: UNMOUNTABLE, 2: GONE }, dataOn: 4 })));

    it('seeds on the holder with data', async function () {
      this.timeout(900000);
      await c.start();
      await c.settle(4, async () => await c.seeded(4) >= 1, 'the holder with data seeds, or the passes go by without it');

      expect(await c.seeders(), 'the holders that seeded').to.deep.equal([4]);
    });
  });
});
