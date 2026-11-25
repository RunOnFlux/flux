// weight: heavy
import {
  describe, it, before,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { moveNodeAddress } from '../framework/container.js';
import { clearNodeAddress, setNodeAddress } from '../framework/daemon-control.js';
import { clearGeolocation, setGeolocationUnavailable } from '../framework/external-http-control.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { deliverApp } from '../framework/app-delivery.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

// A node whose IP moved takes no app until it knows where it now is: the spawner
// is stopped while the move's geolocation is still to be found, between the
// move's passes as well as during them, and starts again once the node is located
// at its new address.
//
// Neither geolocation service can locate the new IP (the external stub answers
// 503), so the move's geolocation lookup fails, and the node goes on holding its
// old address's geolocation. The node's spawner shows each pass it runs by a
// spawner:blocked event, or by a verdict on an app the fleet carries that no node
// can take (its geolocation names Bahrain, where no harness node is).

const SUBJECT = 0;
const API_PORT = 16127;
const DETECTION_MS = 6 * 60 * 1000;
const BEFORE_RECONCILE = 'ownAddress:beforeReconcile';

describe('a node that moved takes no app until it knows where it is', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const moved = [];
  const located = [];
  const far = `e2emovedfar${Date.now()}`;
  const node = () => env.clients[SUBJECT];
  const record = () => dbClient(SUBJECT + 1).ownAddressRecord();
  const verdicts = () => node().getDecisionCount('spawner:verdict', far, 'afterGeolocation');
  const blockedSince = (afterId) => node().getEventBuffer().filter((e) => e.id > afterId && e.event === 'spawner:blocked');

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await deliverApp(env, await buildSeedableApp({
      env, name: far, instances: 3, geolocation: ['acAS_BH'],
    }), [0, 1, 2]);
    await waitFor(async () => (await verdicts()) > 0, {
      timeout: 300000, interval: 5000, label: 'canary: the spawner judges the app no node can take',
    });
  });

  afterTeardown(async function () {
    if (env) await node().releaseAllCheckpoints().catch(() => {});
    await Promise.all(moved.map((ip) => clearNodeAddress(ip).catch(() => {})));
    await Promise.all(located.map((ip) => clearGeolocation(ip).catch(() => {})));
    await env?.teardown();
  });

  it('holds the spawner through the move\'s passes until the node is located at its new address', async function () {
    this.timeout(DETECTION_MS + 600000);
    const from = node().ip;
    const toIp = from.replace(/\.\d+$/, '.242');
    const to = `${toIp}:${API_PORT}`;
    located.push(toIp);
    await setGeolocationUnavailable(toIp);

    // The move's first pass, held once the spawner has been stopped for it.
    await node().holdCheckpoint(BEFORE_RECONCILE, to);
    moved.push(from);
    await moveNodeAddress(node().container, toIp, from);
    await node().followTo(toIp);
    await setNodeAddress(from, toIp, { scope: 'benchmark' });
    let mark = node().getLastEventId();
    await node().waitForEvent('checkpoint:held', (d) => d.name === BEFORE_RECONCILE && d.key === to, DETECTION_MS, { afterId: mark });
    const anchor = node().getLastEventId();
    const verdictsAtMove = await verdicts();
    await node().releaseCheckpoint(BEFORE_RECONCILE, to);

    let own;
    await waitFor(async () => {
      own = await record();
      return own?.socketAddress === to && own.appsHandledAt === own.movedAt;
    }, { timeout: 180000, interval: 2000, label: 'the move\'s apps handled' });
    expect(own.geolocatedAt, 'located at an address neither service could locate').to.equal(null);

    // Two more passes of the move begun, so at least one whole gap between the
    // move's passes, after a pass that found the node not located, has gone by.
    // eslint-disable-next-line no-restricted-syntax
    for (const later of [1, 2]) {
      mark = node().getLastEventId();
      // eslint-disable-next-line no-await-in-loop
      await node().holdCheckpoint(BEFORE_RECONCILE, to);
      // eslint-disable-next-line no-await-in-loop
      await node().waitForEvent('checkpoint:held', (d) => d.name === BEFORE_RECONCILE && d.key === to, 180000, { afterId: mark })
        .catch(() => { throw new Error(`the move's pass ${later + 1} did not begin`); });
      // eslint-disable-next-line no-await-in-loop
      if (later === 1) await node().releaseCheckpoint(BEFORE_RECONCILE, to);
    }
    expect(blockedSince(anchor), 'the spawner ran a pass while the node was not located').to.deep.equal([]);
    expect(await verdicts(), 'the spawner judged an app while the node was not located').to.equal(verdictsAtMove);
    await node().releaseCheckpoint(BEFORE_RECONCILE, to);

    const passesFrom = node().getLastEventId();
    await clearGeolocation(toIp);
    await waitFor(async () => {
      own = await record();
      return own.geolocatedAt === own.movedAt;
    }, { timeout: 180000, interval: 2000, label: 'the node located at its new address once a service answers' });
    await waitFor(async () => blockedSince(passesFrom).length > 0 || (await verdicts()) > verdictsAtMove, {
      timeout: 180000, interval: 2000, label: 'the spawner runs again once the node is located',
    });
  });
});
