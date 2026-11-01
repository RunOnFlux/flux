// weight: light
/*
 * A node removes a mapping it made only while it may still be its own on the router.
 *
 * A removal names an external port, and a router that is not in secure mode removes whatever
 * holds it. So a mapping in the node's record whose lease has run out since its last add, or that
 * the router shows held for another machine, or that the router holds no entry for, is not asked
 * for: its record ends. Any other is removed - the node's own, and one the router answers a lookup
 * of with an empty entry, a fault or nothing, as some routers answer every lookup.
 *
 * Both of the node's removals follow it: its start's cleanup of the mappings in its record nothing
 * holds, and its retry of a removal the router refused. The start's cleanup is read from records
 * written into the node's database while its FluxOS is stopped, against a router table laid out
 * the same way; each case ends with a canary - a mapping inside its lease, recorded last - whose
 * removal shows the cleanup has passed every record before it. The retry is read on the node's
 * UPnP verification's own test mapping, whose removal the router refuses.
 *
 * The cleanup runs once per start, once the node's database is ready, in the node's slot of
 * config.upnp.cleanupCycleMs (60 s in the harness), so the node is one of a peered fleet: the
 * middle of three.
 */
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { crashFluxos, releaseFluxos } from '../framework/container.js';
import { giveNodeApiPort } from '../framework/node-address.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import {
  enableUpnpGateway, setUpnpEmptyLookups, setUpnpLeases, setUpnpLookupFault, setUpnpRefuseDeletes, upnpGatewayState,
} from '../framework/external-http-control.js';
import { dbClient } from '../framework/db-client.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

const SUBJECT = 1;
const API_PORT = 16137;
const TEST_PORT = API_PORT + 3;
// the harness's longest removal retry (config.upnp.removalRetryMaxMs)
const RETRY_MAX_MS = 8000;
// a cleanup in the node's slot of a 60 s cycle, once its database is ready after a start
const CLEANED_WITHIN_MS = 240000;
const HOUR_S = 3600;
// The address the node's own mappings point at: upnp.nodeIp is empty in the harness, so the
// client is given this in its place.
const NODE_CLIENT = '127.0.0.1';

describe('a node removes only a mapping that may still be its own', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let client;
  let nodeIp;
  let otherMachine;
  const db = dbClient(SUBJECT + 1);

  const leased = (port, description, { secondsAgo, lease }) => ({
    port, protocol: 'TCP', description, at: new Date(Date.now() - secondsAgo * 1000), lease,
  });
  const permanent = (port, description) => ({
    port, protocol: 'TCP', description, at: new Date(Date.now() - 24 * HOUR_S * 1000), lease: 0,
  });
  const held = (port, internalClient, description) => ({
    externalPort: port, protocol: 'TCP', internalPort: port, internalClient, description, leaseDuration: 0,
  });
  const removalsOf = (requests, port, fromMs) => requests
    .filter((r) => r.action === 'DeletePortMapping' && r.port === port && Date.parse(r.at) >= fromMs);
  const lookupsOf = (requests, port, fromMs) => requests
    .filter((r) => r.action === 'GetSpecificPortMappingEntry' && r.port === port && Date.parse(r.at) >= fromMs);

  // The node started again with `records` in its record and `table` on its router; resolves once
  // the router has removed `canary`, recorded last, with the gateway's state from the start.
  // `onRouter` sets the router up before the start; `whileStarting` runs alongside it.
  async function startWith({
    records, table, canary, onRouter = async () => {}, whileStarting = async () => {},
  }) {
    await crashFluxos(client.container, { hold: true });
    await db.recordUpnpMappings([...records, leased(canary, 'Flux_App_canary', { secondsAgo: 0, lease: HOUR_S })]);
    await enableUpnpGateway(nodeIp, { mappings: [...table, held(canary, NODE_CLIENT, 'Flux_App_canary')] });
    await onRouter();
    const fromMs = Date.now();
    await releaseFluxos(client.container, { apiPort: API_PORT });
    const alongside = whileStarting();
    let state = { requests: [], mappings: [] };
    await waitFor(async () => {
      state = await upnpGatewayState(nodeIp);
      return removalsOf(state.requests, canary, fromMs).some((r) => !r.refused);
    }, { timeout: CLEANED_WITHIN_MS, interval: 2000, label: `the canary ${canary} removed by the start's cleanup` });
    await alongside;
    return { state, fromMs };
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } } });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    client = env.clients[SUBJECT];
    nodeIp = subnet.nodeIp(SUBJECT + 1);
    // a machine behind the same router that is not this node
    otherMachine = nodeIp.replace(/\.\d+$/, '.240');
    await enableUpnpGateway(nodeIp);
    await giveNodeApiPort(env, SUBJECT, API_PORT);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('at its start, sends nothing for a mapping whose lease has run out or the router holds for another machine or not at all, and removes its own', async function () {
    this.timeout(CLEANED_WITHIN_MS + 180000);
    const records = [
      leased(31101, 'Flux_App_lapsed_taken', { secondsAgo: 2 * HOUR_S, lease: HOUR_S }),
      leased(31102, 'Flux_App_lapsed', { secondsAgo: 2 * HOUR_S, lease: HOUR_S }),
      leased(31103, 'Flux_App_inside_lease', { secondsAgo: 60, lease: HOUR_S }),
      permanent(31104, 'Flux_App_taken'),
      permanent(31105, 'Flux_App_own'),
      permanent(31106, 'Flux_App_not_held'),
    ];
    const table = [
      held(31101, otherMachine, 'Flux_App_another'),
      held(31103, NODE_CLIENT, 'Flux_App_inside_lease'),
      held(31104, otherMachine, 'Flux_App_another'),
      held(31105, NODE_CLIENT, 'Flux_App_own'),
    ];

    const { state, fromMs } = await startWith({ records, table, canary: 31199 });

    const removed = (port) => removalsOf(state.requests, port, fromMs).length > 0;
    expect(removed(31101), 'a lapsed lease, the port now another machine\'s').to.equal(false);
    expect(removed(31102), 'a lapsed lease, the port free').to.equal(false);
    expect(removed(31104), 'permanent, the router shows another machine').to.equal(false);
    expect(removed(31106), 'permanent, the router holds no entry').to.equal(false);
    expect(lookupsOf(state.requests, 31101, fromMs), 'a lapsed lease is not looked up').to.deep.equal([]);
    expect(lookupsOf(state.requests, 31104, fromMs).length, 'canary: the permanent one looked up').to.be.at.least(1);
    expect(removed(31103), 'inside its lease, its own').to.equal(true);
    expect(removed(31105), 'permanent, its own').to.equal(true);
    expect(state.mappings.filter((m) => m.internalClient === otherMachine).map((m) => m.externalPort).sort(),
      'another machine\'s mappings').to.deep.equal([31101, 31104]);
    // eslint-disable-next-line no-restricted-syntax
    for (const { port } of records) {
      // eslint-disable-next-line no-await-in-loop
      expect(await db.upnpMappingRecord(port), `the record of ${port} ended`).to.equal(null);
    }
  });

  it('at its start, removes a permanent mapping of its own on a router that answers every lookup with an empty entry', async function () {
    this.timeout(CLEANED_WITHIN_MS + 180000);
    const { state, fromMs } = await startWith({
      records: [permanent(31201, 'Flux_App_own')],
      table: [held(31201, NODE_CLIENT, 'Flux_App_own')],
      canary: 31299,
      onRouter: () => setUpnpEmptyLookups(nodeIp, true),
    });

    expect(lookupsOf(state.requests, 31201, fromMs).length, 'canary: looked up').to.be.at.least(1);
    expect(removalsOf(state.requests, 31201, fromMs).length, 'removed').to.be.at.least(1);
    expect(state.mappings.some((m) => m.externalPort === 31201), 'gone from the router').to.equal(false);
  });

  it('at its start, removes a permanent mapping of its own on a router that answers its lookup with a fault', async function () {
    this.timeout(CLEANED_WITHIN_MS + 180000);
    // the fault comes once the node has verified UPnP, which reads its test mapping back
    let faulted = false;
    const { state, fromMs } = await startWith({
      records: [permanent(31301, 'Flux_App_own')],
      table: [held(31301, NODE_CLIENT, 'Flux_App_own')],
      canary: 31399,
      whileStarting: async () => {
        await waitFor(async () => (await upnpGatewayState(nodeIp)).requests
          .some((r) => r.action === 'GetSpecificPortMappingEntry' && r.port === TEST_PORT), { timeout: 120000, interval: 500, label: 'the verification read its test mapping back' });
        await setUpnpLookupFault(nodeIp, 501);
        faulted = true;
      },
    });

    expect(faulted, 'canary: the router answered lookups with a fault').to.equal(true);
    expect(lookupsOf(state.requests, 31301, fromMs).some((r) => r.refused === 501), 'canary: its lookup faulted').to.equal(true);
    expect(removalsOf(state.requests, 31301, fromMs).length, 'removed').to.be.at.least(1);
    await setUpnpLookupFault(nodeIp, null);
  });

  it('asks again for a refused removal only while the lease of the mapping\'s last add runs, and sends nothing for the port once another machine holds it', async function () {
    this.timeout(600000);
    await crashFluxos(client.container, { hold: true });
    await enableUpnpGateway(nodeIp);
    await setUpnpRefuseDeletes(nodeIp, Infinity);
    const fromMs = Date.now();
    await releaseFluxos(client.container, { apiPort: API_PORT });

    // the verification's test mapping, and the renewal test's after it, each refused its removal
    let state = { requests: [], mappings: [] };
    let lastAdd = null;
    await waitFor(async () => {
      state = await upnpGatewayState(nodeIp);
      const adds = state.requests.filter((r) => r.action === 'AddPortMapping' && r.port === TEST_PORT && Date.parse(r.at) >= fromMs);
      lastAdd = adds[adds.length - 1] ?? null;
      return lastAdd && lastAdd.lease > 0 && Date.now() > Date.parse(lastAdd.at) + lastAdd.lease * 1000 + 3 * RETRY_MAX_MS;
    }, { timeout: 480000, interval: 2000, label: 'the lease of the test mapping\'s last add run out' });
    const leaseEndMs = Date.parse(lastAdd.at) + lastAdd.lease * 1000;
    const refusedAsks = removalsOf(state.requests, TEST_PORT, fromMs);
    expect(refusedAsks.length, 'canary: the router refused the removal, and was asked again').to.be.at.least(2);
    expect(removalsOf(state.requests, TEST_PORT, leaseEndMs + RETRY_MAX_MS), 'asked after the lease ran out').to.deep.equal([]);

    // the port is another machine's now, and the router takes removals
    await enableUpnpGateway(nodeIp, { mappings: [held(TEST_PORT, otherMachine, 'Flux_App_another')] });
    const takenFromMs = Date.now();
    await new Promise((resolve) => { setTimeout(resolve, 4 * RETRY_MAX_MS); });
    state = await upnpGatewayState(nodeIp);
    expect(removalsOf(state.requests, TEST_PORT, takenFromMs), 'a removal of another machine\'s port').to.deep.equal([]);
    expect(state.mappings.some((m) => m.externalPort === TEST_PORT && m.internalClient === otherMachine), 'another machine\'s mapping kept').to.equal(true);
  });

  it('asks again for a refused removal of a permanent mapping until it goes, on a router that answers every lookup with an empty entry', async function () {
    this.timeout(300000);
    await crashFluxos(client.container, { hold: true });
    await enableUpnpGateway(nodeIp, { refuseDeletes: 1 });
    // a router that refuses a lease: every mapping is permanent, and no renewal test runs
    await setUpnpLeases(nodeIp, { fault: 725 });
    await setUpnpEmptyLookups(nodeIp, true);
    const fromMs = Date.now();
    await releaseFluxos(client.container, { apiPort: API_PORT });

    let state = { requests: [], mappings: [] };
    await waitFor(async () => {
      state = await upnpGatewayState(nodeIp);
      return removalsOf(state.requests, TEST_PORT, fromMs).some((r) => !r.refused);
    }, { timeout: 240000, interval: 2000, label: 'the test mapping removed once the router took it' }).catch(() => {});

    const asks = removalsOf(state.requests, TEST_PORT, fromMs);
    expect(asks.length && asks[0].refused, 'canary: the router refused the first removal').to.equal(501);
    expect(lookupsOf(state.requests, TEST_PORT, fromMs).length, 'canary: the retry looked it up').to.be.at.least(1);
    expect(asks.some((r) => !r.refused), 'asked again, and removed').to.equal(true);
    expect(state.mappings.some((m) => m.externalPort === TEST_PORT), 'gone from the router').to.equal(false);
  });
});
