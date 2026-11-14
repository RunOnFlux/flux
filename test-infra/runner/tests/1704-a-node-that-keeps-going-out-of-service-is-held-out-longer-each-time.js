// weight: heavy
import {
  describe, it, before,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  crashFluxos, releaseFluxos, restartFluxos, setNodeApiPort,
} from '../framework/container.js';
import { setHeight, stopTicker } from '../framework/daemon-control.js';
import { enableUpnpGateway, setUpnpCapacity, upnpGatewayState } from '../framework/external-http-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { loadSharedConfig } from '../framework/coupled-knobs.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const subnet = getSubnetConfig();

// A node that keeps going out of service is held out longer each time. Each
// time it enters DOS the height is recorded; counted over the last windowBlocks,
// a 1st or 2nd episode keeps it from taking new apps for quarantineBlocks once
// it is back in service, a 3rd holds it out of service for shortHoldBlocks and
// then from new apps for heldQuarantineBlocks, and a 4th or later holds it out
// for longHoldBlocks. The lengths are the fleet's config.dosRecurrence.
//
// Each episode is the fault itself: the node sits behind a UPnP router whose
// table is made full, so the availability check's own test mappings are
// refused and the node goes DOS through the check; the table is given room
// again to end it. The node's apps port check runs every few seconds rather
// than production's ten minutes after a passing test, so the full table is
// found at once; its DOS threshold is production's.
//
// The chain is stopped once the fleet has peered and only moved forward by the
// suite, so every episode is recorded at a height the suite set, and holds end
// only when the suite moves it.
// Whether a hold stands at a height is read from the service's snapshot once it
// has judged that height.

const SUBJECT = 1;
const DOS_THRESHOLD = 100;
const ERROR_WAIT_MS = 1000;
const PASSED_WAIT_MS = 5000;
const DOS_WAIT_MS = 5000;
const APPS_PORT_CHECK = {
  timeoutsMs: {
    default: PASSED_WAIT_MS, error: ERROR_WAIT_MS, failure: 1000, dos: DOS_WAIT_MS, appError: 5000,
  },
  thresholds: { dos: DOS_THRESHOLD, portsHighEdge: 3, portsLowEdge: 1 },
};
// each refused pass adds 4 (availabilityChecker.countPortFailure); a pass waits
// ERROR_WAIT_MS after a refusal, and takes as long again
const PASSES_TO_DOS = DOS_THRESHOLD / 4;
const OUT_WITHIN_MS = PASSED_WAIT_MS + 2 * PASSES_TO_DOS * ERROR_WAIT_MS + 30000;
const BACK_WITHIN_MS = DOS_WAIT_MS + 60000;
// The node's short-lived mappings (upnpRouter's test mapping names): each comes
// and goes within a pass, so a table capped while one is on it has a slot again
// once it goes.
const isTestMapping = (m) => ['Flux_UPNP_Mapping_Test', 'Flux_Test_App'].includes(m.description)
  || String(m.description ?? '').startsWith('Flux_Prelaunch_App_');
const UPNP_DOS = 'Not possible to run applications on the node, router returning exceptions when creating UPNP ports mappings';
const OWNER = 'dosRecurrence';

// the fleet's recurrence lengths, in blocks (config.dosRecurrence)
const {
  quarantineBlocks: QUARANTINE_BLOCKS,
  heldQuarantineBlocks: HELD_QUARANTINE_BLOCKS,
  shortHoldBlocks: SHORT_HOLD_BLOCKS,
  longHoldBlocks: LONG_HOLD_BLOCKS,
  windowBlocks: WINDOW_BLOCKS,
} = loadSharedConfig().dosRecurrence;

describe('a node that keeps going out of service is held out longer each time', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let nodeIp;
  // the heights the first, second and fourth episodes are recorded at
  let firstHeight;
  let secondHeight;
  let fourthHeight;
  const node = () => env.clients[SUBJECT];
  const dos = async () => (await node().getDOSState()).data ?? {};
  const recurrence = () => node().getTestState('dosRecurrence');
  const testMappingsSince = (requests, sinceMs) => requests.filter((r) => r.action === 'AddPortMapping'
    && r.description === 'Flux_Test_App' && Date.parse(r.at) >= sinceMs);

  // The router's table is made full of the node's lasting mappings until the
  // node is out of service for it; resolves with the record the episode left,
  // once saved.
  // The record's other writes - the quarantine a recovery sets - can land after
  // the anchor, so the episode is the write that adds one.
  async function routerRefusesUntilOutOfService() {
    const mark = node().getLastEventId();
    const before = (await recurrence()).record.episodeHeights.length;
    const { mappings } = await upnpGatewayState(nodeIp);
    await setUpnpCapacity(nodeIp, mappings.filter((m) => !isTestMapping(m)).length);
    await node().waitForEvent('dos:changed', (d) => d.dosState >= DOS_THRESHOLD && d.dosMessage === UPNP_DOS, OUT_WITHIN_MS, { afterId: mark });
    const { data } = await node().waitForEvent('dosRecurrence:changed', (d) => d.episodeHeights.length === before + 1, 30000, { afterId: mark });
    return data;
  }

  // The router has room again; resolves once a test mapping it took has run.
  async function routerTakesMappingsAgain() {
    const from = Date.now();
    await setUpnpCapacity(nodeIp, null);
    await waitFor(async () => testMappingsSince((await upnpGatewayState(nodeIp)).requests, from)
      .some((r) => r.refused === undefined), {
      timeout: BACK_WITHIN_MS, interval: 1000, label: 'a test mapping the router took',
    });
  }

  // Moves the chain to `height` and resolves once the service has judged it.
  async function chainAt(height) {
    await setHeight(height);
    await waitFor(async () => (await recurrence()).judgedHeight >= height, {
      timeout: 60000, interval: 1000, label: `the service judged height ${height}`,
    });
    return (await recurrence()).record;
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      nodeConfigOverrides: { [SUBJECT]: { fluxapps: { appsPortCheck: APPS_PORT_CHECK } } },
    });
    nodeIp = subnet.nodeIp(SUBJECT + 1);
    // the first boot writes userconfig.js; a node with an api port in it
    // verifies UPnP when it starts
    await waitForBootSettled(node());
    await enableUpnpGateway(nodeIp);
    await setNodeApiPort(node().container, 16127);
    await restartFluxos(node().container);
    await bootAndPeer(env);
    await stopTicker();

    const { requests } = await upnpGatewayState(nodeIp);
    expect(requests.some((r) => r.action === 'AddPortMapping' && r.description === 'Flux_UPNP_Mapping_Test'), 'canary: the node verified UPnP on its gateway').to.equal(true);
    expect((await dos()).dosState ?? 0, 'fixture: in service before the first episode').to.be.below(DOS_THRESHOLD);
    expect((await recurrence()).record.episodeHeights, 'fixture: no episode recorded').to.deep.equal([]);
  });

  afterTeardown(async function () {
    if (nodeIp) await setUpnpCapacity(nodeIp, null).catch(() => {});
    await env?.teardown();
  });

  it(`takes no new apps for ${QUARANTINE_BLOCKS} blocks once back in service from a first episode, then takes them`, async function () {
    this.timeout(OUT_WITHIN_MS + BACK_WITHIN_MS + 300000);
    const episode = await routerRefusesUntilOutOfService();
    expect(episode.episodeHeights).to.have.lengthOf(1);
    expect(episode.dosHold, 'held out of service for one episode').to.equal(null);
    [firstHeight] = episode.episodeHeights;

    const mark = node().getLastEventId();
    await routerTakesMappingsAgain();
    await node().waitForEvent('dos:changed', (d) => d.dosState < DOS_THRESHOLD, BACK_WITHIN_MS, { afterId: mark });
    const { data: hold } = await node().waitForEvent('placementHold:set', (d) => d.owner === OWNER, 30000, { afterId: mark });
    expect(hold.reason).to.match(/^No new apps until block/);
    // canary: the spawner reads the hold this service set
    await node().waitForEvent('spawner:blocked', (d) => d.reason === 'placement_hold', 180000, { afterId: mark });

    const { placementHold } = (await recurrence()).record;
    expect(placementHold).to.deep.equal({ fromHeight: firstHeight, blocks: QUARANTINE_BLOCKS });
    expect((await chainAt(firstHeight + QUARANTINE_BLOCKS - 1)).placementHold, `held ${QUARANTINE_BLOCKS - 1} blocks on`).to.not.equal(null);

    const released = node().getLastEventId();
    expect((await chainAt(firstHeight + QUARANTINE_BLOCKS)).placementHold, `released ${QUARANTINE_BLOCKS} blocks on`).to.equal(null);
    await node().waitForEvent('placementHold:cleared', (d) => d.owner === OWNER, 30000, { afterId: released });
  });

  it('is back in service once its router recovers from a second episode in the window', async function () {
    this.timeout(OUT_WITHIN_MS + BACK_WITHIN_MS + 120000);
    const episode = await routerRefusesUntilOutOfService();
    secondHeight = firstHeight + QUARANTINE_BLOCKS;
    expect(episode.episodeHeights).to.deep.equal([firstHeight, secondHeight]);
    expect(episode.dosHold).to.equal(null);

    const mark = node().getLastEventId();
    await routerTakesMappingsAgain();
    await node().waitForEvent('dos:changed', (d) => d.dosState < DOS_THRESHOLD, BACK_WITHIN_MS, { afterId: mark });
  });

  it(`stays out of service from a third episode in the window, through a FluxOS restart, until ${SHORT_HOLD_BLOCKS} blocks have passed`, async function () {
    this.timeout(OUT_WITHIN_MS + 2 * BACK_WITHIN_MS + 600000);
    const episode = await routerRefusesUntilOutOfService();
    expect(episode.episodeHeights).to.deep.equal([firstHeight, secondHeight, secondHeight]);
    expect(episode.dosHold).to.deep.equal({ fromHeight: secondHeight, blocks: SHORT_HOLD_BLOCKS });

    // the router recovers and the check passes: the node stays out of service
    await routerTakesMappingsAgain();
    await waitFor(async () => (await dos()).dosMessage !== UPNP_DOS, {
      timeout: BACK_WITHIN_MS, interval: 1000, label: 'the router\'s DOS ended',
    });
    const held = await dos();
    expect(held.dosState).to.equal(DOS_THRESHOLD);
    expect(held.dosMessage).to.match(/^Out of service until block \d+: 3 DOS episodes in 24 hours$/);

    await crashFluxos(node().container, { hold: true });
    await releaseFluxos(node().container);
    await waitFor(async () => /^Out of service until block/.test((await dos()).dosMessage ?? ''), {
      timeout: 120000, interval: 2000, label: 'out of service again once FluxOS is back',
    });

    expect((await chainAt(secondHeight + SHORT_HOLD_BLOCKS - 1)).dosHold, `held ${SHORT_HOLD_BLOCKS - 1} blocks on`).to.not.equal(null);
    expect((await dos()).dosState).to.equal(DOS_THRESHOLD);

    const mark = node().getLastEventId();
    const released = await chainAt(secondHeight + SHORT_HOLD_BLOCKS);
    expect(released.dosHold).to.equal(null);
    await node().waitForEvent('dos:changed', (d) => d.dosState < DOS_THRESHOLD, 60000, { afterId: mark });
    await waitFor(async () => (await recurrence()).record.placementHold !== null, {
      timeout: 30000, interval: 1000, label: 'the placement hold after a held episode',
    });
    expect((await recurrence()).record.placementHold.blocks).to.equal(HELD_QUARANTINE_BLOCKS);
  });

  it(`is held out of service for ${LONG_HOLD_BLOCKS} blocks from a fourth episode in the window`, async function () {
    this.timeout(OUT_WITHIN_MS + BACK_WITHIN_MS + 120000);
    const episode = await routerRefusesUntilOutOfService();
    fourthHeight = secondHeight + SHORT_HOLD_BLOCKS;
    expect(episode.episodeHeights).to.deep.equal([firstHeight, secondHeight, secondHeight, fourthHeight]);
    expect(episode.dosHold).to.deep.equal({ fromHeight: fourthHeight, blocks: LONG_HOLD_BLOCKS });
    await routerTakesMappingsAgain();
  });

  it(`counts only the episodes inside the last ${WINDOW_BLOCKS} blocks`, async function () {
    this.timeout(OUT_WITHIN_MS + BACK_WITHIN_MS + 120000);
    const pastEverything = fourthHeight + Math.max(LONG_HOLD_BLOCKS, WINDOW_BLOCKS);
    const mark = node().getLastEventId();
    const record = await chainAt(pastEverything);
    expect(record.dosHold, 'the 2880-block hold ended').to.equal(null);
    expect(record.episodeHeights, 'every episode out of the window').to.deep.equal([]);
    await node().waitForEvent('dos:changed', (d) => d.dosState < DOS_THRESHOLD, 60000, { afterId: mark });

    const episode = await routerRefusesUntilOutOfService();
    expect(episode.episodeHeights).to.deep.equal([pastEverything]);
    expect(episode.dosHold, 'counted with the episodes before the window').to.equal(null);
  });
});
