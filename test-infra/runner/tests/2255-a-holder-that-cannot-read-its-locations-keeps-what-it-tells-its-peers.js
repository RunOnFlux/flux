// weight: heavy
import {
  describe, it, before, after, afterEach,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { resetSyncState, pinColdStart } from '../framework/syncthing-control.js';
import { resetFdm } from '../framework/fdm-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { gComponent, watchGComponents } from '../framework/g-components.js';
import { crashFluxos, releaseFluxos } from '../framework/container.js';
import { failCommands } from '../framework/mongo-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Cold starts of a g: app where the holder at the higher address cannot read its
// locations: every read of its location records fails. Its monitor holds the folder
// out of each pass, and what it tells its peers of the folder stays as it was - a
// read that failed says nothing about what the volume holds.
//
// The lowest address decides the seed. Beside a holder that measured the folder
// before its reads failed, it seeds. Beside one that has not looked at the folder
// since its FluxOS restarted, it waits, and seeds once that holder can read again.
//
// The lowest address is held before it measures until the other holder's reads have
// failed, so the decisions under test are made with the answer that holder gives then.

const subnet = getSubnetConfig();
const APP_UID = 1000;
const COMPONENT = 'data';
const BEFORE_HOLDINGS = 'syncthing:beforeHoldings';
const SETTLE_PASSES = 6;
const unreadableLocations = (i) => failCommands(i + 1, 'globalzelapps', 'zelappslocation', { commands: ['find'] });

describe('a holder that cannot read its locations keeps what it tells its peers', function () {
  let env;
  let release = null;
  dumpLogsOnFailure(() => env);
  const client = (i) => env.clients[i];

  // One app per case, on its own two holders: `lowest` decides, `other` cannot read.
  function coldStartCase(tag, { lowest, other }) {
    const appName = `e2elocunread${tag}${Date.now()}`;
    const watch = watchGComponents(() => env, { appName, components: [COMPONENT], holders: [lowest, other] });
    const folder = watch.folderOf(COMPONENT);
    const count = (i, counter, decision) => client(i).getDecisionCount(counter, folder, decision);
    return {
      folder,
      seeded: (i) => count(i, 'syncthing:seedDecision', 'seeded'),
      waitedOnLook: (i) => count(i, 'syncthing:seedDecision', 'holderNotLookedAt'),
      waitedOnVolume: (i) => count(i, 'syncthing:seedDecision', 'holderVolumeHeldOut'),
      passes: (i) => count(i, 'syncthing:folderPass', 'evaluated'),
      unread: (i) => count(i, 'syncthing:folderPass', 'locationsUnread'),

      // Placed on both, the lowest held before it measures.
      async place() {
        expect(subnet.nodeIp(lowest + 1) < subnet.nodeIp(other + 1), 'fixture: the deciding holder is not the lowest address').to.equal(true);
        await pushTestApp(appName, 'v1', 'locunread', { user: APP_UID });
        const app = await buildSeedableApp({
          env, name: appName, instances: 2, compose: [gComponent(appName, COMPONENT)],
        });
        await pinColdStart([lowest, other], folder);
        const from = client(lowest).getLastEventId();
        await client(lowest).holdCheckpoint(BEFORE_HOLDINGS, folder);
        await installOnNodes(env, app, [lowest, other]);
        await client(lowest).waitForEvent('checkpoint:held', (d) => d.name === BEFORE_HOLDINGS && d.key === folder, 300000, { afterId: from });
        await waitFor(async () => await this.passes(other) >= 2, {
          timeout: 300000, interval: 2000, label: 'the other holder has measured the folder',
        });
      },

      // The lowest released, until `done` or SETTLE_PASSES of its passes go by.
      async decide(done, label) {
        const from = await this.passes(lowest);
        await client(lowest).releaseCheckpoint(BEFORE_HOLDINGS, folder);
        await waitHolding(async () => {
          await watch.oneHolderAtMost();
          return await done() || await this.passes(lowest) >= from + SETTLE_PASSES;
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

  afterEach(async function () {
    this.timeout(60000);
    await release?.().catch(() => {});
    release = null;
    await Promise.all((env?.clients ?? []).map((c) => c?.releaseAllCheckpoints().catch(() => {})));
  });

  after(async function () {
    this.timeout(60000);
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('seeds beside a holder that measured the folder before its reads failed', async function () {
    this.timeout(900000);
    const c = coldStartCase('measured', { lowest: 1, other: 2 });
    await c.place();
    release = await unreadableLocations(2);
    await waitFor(async () => await c.unread(2) >= 1, {
      timeout: 120000, interval: 2000, label: 'the other holder cannot read its locations',
    });

    await c.decide(async () => await c.seeded(1) >= 1, 'the lowest address seeds, or the passes go by without it');

    expect(await c.seeded(1), `the lowest address did not seed in ${SETTLE_PASSES} passes`).to.be.at.least(1);
    expect(await c.waitedOnVolume(1), 'the lowest address waited on a holder that only could not read its locations').to.equal(0);
  });

  it('waits on a holder that has not looked at the folder since it restarted, and seeds once it can read again', async function () {
    this.timeout(900000);
    const c = coldStartCase('notlooked', { lowest: 3, other: 4 });
    await c.place();
    await crashFluxos(client(4).container, { hold: true });
    release = await unreadableLocations(4);
    await releaseFluxos(client(4).container);
    await waitFor(async () => await c.unread(4) >= 1, {
      timeout: 300000, interval: 2000, label: 'the restarted holder cannot read its locations',
    });

    const waitsBefore = await c.waitedOnLook(3);
    await c.decide(async () => await c.seeded(3) >= 1, 'the lowest address seeds, or the passes go by without it');
    expect(await c.seeded(3), 'seeded beside a holder that has not looked at the folder').to.equal(0);
    expect(await c.waitedOnLook(3) - waitsBefore, 'the lowest address never waited on the holder that has not looked').to.be.at.least(1);

    await release();
    release = null;
    await waitFor(async () => await c.seeded(3) >= 1, {
      timeout: 300000, interval: 2000, label: 'the lowest address seeds once the other holder can read its locations',
    });
  });
});
