// weight: light
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { giveNodeApiPort } from '../framework/node-address.js';
import { enableUpnpGateway, upnpGatewayState } from '../framework/external-http-control.js';
import { holdCommands, releaseCommands } from '../framework/mongo-control.js';
import { loadSharedConfig } from '../framework/coupled-knobs.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A router turn records a mapping before it asks for it (upnpRouter's
// RecordingClient), and each record write ends within config.upnp.recordWriteLimitMs,
// so a database that holds every command leaves the router's mappings going ahead.
//
// The turn is the refresh of the node's own ports: every portRestoreIntervalMs it
// maps its four core ports again, one add each, and touches the database for
// nothing but those records. With the database held for twice as long as a whole
// refresh takes when every record write runs to its bound, the router hears the
// four adds while the database still holds; a write without the bound would wait
// out the hold, and the router would hear nothing until it ended.

const API_PORT = 16137;
const CORE_PORTS = [API_PORT - 1, API_PORT, API_PORT + 1, API_PORT + 2];
const REFRESH_CYCLE_MS = loadSharedConfig().fluxapps.portRestoreIntervalMs;
// config.upnp.recordWriteLimitMs, which the harness leaves at production's
const RECORD_WRITE_LIMIT_MS = 5000;
// upnpRouter.pause after each map
const PAUSE_AFTER_MAP_MS = 500;
// the next refresh slot, then each core port's record write at its bound and its add
const REFRESHED_WITHIN_MS = REFRESH_CYCLE_MS + CORE_PORTS.length * (RECORD_WRITE_LIMIT_MS + PAUSE_AFTER_MAP_MS) + 10000;
const HOLD_MS = 2 * REFRESHED_WITHIN_MS;
// waitForBootSettled's own budget for the first boot, and the boot on the new port's
const FIRST_BOOT_MS = 120000;
const PORT_BOOT_MS = 180000;

// The core ports the router was asked to add since `since` (ms), in CORE_PORTS order.
function addedSince(since, requests) {
  return CORE_PORTS.filter((port) => requests.some((r) => r.action === 'AddPortMapping'
    && r.port === port && Date.parse(r.at) > since));
}

describe('a router turn maps its port while the database holds the record', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let nodeIp;
  let held = false;

  before(async function () {
    // createTestEnv adds the time it queued for a boot (hookCtx)
    this.timeout(FIRST_BOOT_MS + PORT_BOOT_MS + REFRESHED_WITHIN_MS);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false });
    nodeIp = subnet.nodeIp(1);
    // the first boot writes userconfig.js (its identity) and would put back the old port
    await waitForBootSettled(env.clients[0], FIRST_BOOT_MS);
    await enableUpnpGateway(nodeIp);
    const mark = env.clients[0].getLastEventId();
    await giveNodeApiPort(env, 0, API_PORT);
    // The refresh starts once the boot on the new port has settled; the hold
    // waits for one refresh to have asked the router for every core port.
    await waitForBootSettled(env.clients[0], PORT_BOOT_MS, { afterId: mark });
    const settledAt = Date.now();
    await waitFor(async () => addedSince(settledAt, (await upnpGatewayState(nodeIp)).requests).length === CORE_PORTS.length,
      { timeout: REFRESHED_WITHIN_MS, interval: 1000, label: 'a refresh asking the router for every core port' });
  });

  after(async function () {
    // a release, then the teardown every suite gives 60 s
    this.timeout(HOLD_MS + 60000);
    if (held) await releaseCommands().catch(() => {});
    await env?.teardown();
  });

  it('asks the router for each core port while the database holds its record', async function () {
    // the refresh's own budget, then a release, which waits at most for the rest of the hold
    this.timeout(REFRESHED_WITHIN_MS + HOLD_MS);
    const heldAt = Date.now();
    await holdCommands(HOLD_MS);
    held = true;

    let added = [];
    await waitFor(async () => {
      added = addedSince(heldAt, (await upnpGatewayState(nodeIp)).requests);
      return added.length === CORE_PORTS.length;
    }, { timeout: REFRESHED_WITHIN_MS, interval: 1000, label: 'every core port added again while the database holds' }).catch(() => {});
    const stillHeld = Date.now() - heldAt < HOLD_MS;

    const heldFrom = await releaseCommands();
    held = false;

    expect(heldFrom[nodeIp] ?? 0, 'canary: the node\'s commands reached the database and were held').to.be.above(0);
    expect(stillHeld, 'checked while the database still held').to.equal(true);
    expect(added, 'core ports the router was asked for again while the database held').to.deep.equal(CORE_PORTS);
  });
});
