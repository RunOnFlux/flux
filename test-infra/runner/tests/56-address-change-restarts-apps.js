import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { getAppContainerStatus, moveNodeAddress } from '../framework/container.js';
import { setNodeAddress, clearNodeAddress } from '../framework/daemon-control.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, seedAndInstall } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// When a node's address moves, every app that stays has to come up on the new one.
// The app here is COMPOSED, and that is the whole fixture: a composed app has no
// container under its bare app name - its containers are `<component>_<app>` - so
// anything restarting it by that name resolves nothing. Both components must come
// back, which is only true if the restart is asked for per component.
//
// The fixture reproduces the state a node is actually in when its address moves,
// which is the only state in which it can notice.
//
// Benchmark's public-IP probe reads the NEW address while everything else - its own
// reported address, its status, its entry in the deterministic list - still says the
// old one (`scope: 'publicip'`). Those two answers disagreeing IS the detection.
// Moving them together instead describes a change already settled everywhere, which
// no node ever has to detect.
//
// And the node actually moves (moveNodeAddress): the new address goes on its
// interface and the old one comes off. Its peers then find it unreachable at the
// old address because it genuinely is not there, which is what the path requires -
// a node only asks benchmark whether its address moved after a peer has failed to
// reach it, so a node that is still perfectly reachable never asks.
//
// Moving it for real rather than simulating unreachability is what lets both
// assertions hold at once. The node list is untouched, so peers still recognise it
// as the sender of the fluxipchanged broadcast below - hiding it from their lists
// would make them answer "unreachable" just as reliably and then reject that
// broadcast as coming from a stranger.
//
// The client follows it (followTo). The harness otherwise reaches a node at a fixed
// address, so a node that really moves goes blind to its own client and the suite
// fails because the observer was left behind rather than because anything broke.
//
// Leaving the list alone matters twice over. It is what lets the node pass its own
// confirmed-list check and run the availability check at all - and it is what lets
// its peers ACCEPT the fluxipchanged broadcast afterwards, since they resolve the
// sender by the OLD address the message carries.
//
// Three nodes, not ten: one node runs the app and the others are there to be
// peers. No election is involved, so there is no quorum to satisfy.

const COMPONENT_A = 'alpha';
const COMPONENT_B = 'beta';

async function isUp(client, identifier) {
  const status = await getAppContainerStatus(client.container, identifier);
  return Boolean(status && status.status.startsWith('Up'));
}

describe('a node whose address changed restarts the apps that stay', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  let nodeIp;
  let movedIp;
  let baseline;
  let peerIdx;
  let peerBaseline;
  const appName = `e2eipchg${Date.now()}`;
  const idA = `${COMPONENT_A}_${appName}`;
  const idB = `${COMPONENT_B}_${appName}`;

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });

    await pushImage(appName, 'v1');
    const component = (name, port) => ({
      name,
      description: 'address-change component',
      repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
      ports: [port],
      domains: [''],
      environmentParameters: [],
      commands: [],
      containerPorts: [80],
      containerData: '/tmp',
      cpu: 0.1,
      ram: 100,
      hdd: 1,
      repoauth: '',
    });
    const app = await buildSeedableApp({
      name: appName,
      compose: [component(COMPONENT_A, 31801), component(COMPONENT_B, 31802)],
    });
    idx = await seedAndInstall(env, app);
    nodeIp = subnet.nodeIp(idx + 1);
    // Inside the fleet's own /24, so the node can hold it on the same interface and
    // its peers can route to it; high enough that no node in the run occupies it.
    movedIp = nodeIp.replace(/\.\d+$/, '.240');

    const client = env.clients[idx];
    await waitFor(async () => (await isUp(client, idA)) && (await isUp(client, idB)), {
      timeout: 120000,
      interval: 3000,
      label: 'both components running before the address moves',
    });

    peerIdx = (idx + 1) % env.clients.length;
    peerBaseline = env.clients[peerIdx].getLastEventId();

    // The node moves first, then the probe reports it. In that order the node cannot
    // conclude it is fine before it has anything to compare.
    await moveNodeAddress(client.container, movedIp, nodeIp);
    // Follow it, or every assertion below is made against an address nothing answers
    // on. The reconnect resets the buffer, so the baseline is taken from here.
    baseline = await client.followTo(movedIp);
    await setNodeAddress(nodeIp, movedIp, { scope: 'publicip' });
  });

  after(async function () {
    this.timeout(60000);
    await clearNodeAddress(nodeIp).catch(() => {});
    await env?.teardown();
  });

  it('restarts every component of a composed app, not just the first', async function () {
    // Detection is not immediate and cannot be hurried: a node only asks benchmark
    // about its address after a peer has failed to reach it, and it takes several
    // availability cycles - the collision check re-arms on a 60s timer - to get
    // there. Measured at ~4 minutes from the block to the broadcast, so this covers
    // that plus the reconciler actuating the restarts it queued, which follows.
    //
    // This is the LATER of the two events the suite waits on: the handler records
    // the restart intents, broadcasts, and only then does the reconciler act. Test
    // two's marker has already arrived by the time this one does, and is served from
    // the event buffer rather than waited for.
    this.timeout(480000);
    const client = env.clients[idx];

    // Both, each on its own identifier. Asserting only component A would pass on a
    // node that never reached component B, which is precisely the failure here.
    await waitForReconcileActuated(client, idA, 'restarted', 360000, { afterId: baseline });
    await waitForReconcileActuated(client, idB, 'restarted', 360000, { afterId: baseline });

    await waitFor(async () => (await isUp(client, idA)) && (await isUp(client, idB)), {
      timeout: 120000,
      interval: 3000,
      label: 'both components running again after the address moved',
    });
  });

  it('tells the rest of the fleet, which is work that follows the app loop', async function () {
    // The apps are not the end of the handler: the fluxipchanged broadcast is sent
    // AFTER the loop that deals with them. An app-handling failure that escaped the
    // loop would take that with it, so a PEER seeing the change is what distinguishes
    // a handler that ran to the end from one that stopped at the first composed app.
    //
    // Asserted on a peer rather than on the mover, and on this message rather than on
    // the confirmation transaction that follows it: adjustExternalIP is the only
    // sender of fluxipchanged, whereas createConfirmationTransaction is also sent by
    // the collateral-takeover path in checkDeterministicNodesCollisions - so that RPC
    // arriving would not have told us which handler ran.
    this.timeout(120000);
    const peer = env.clients[peerIdx];

    // The addresses are carried as ip:port, so compare the address alone rather
    // than by prefix - .10 is a prefix of .100.
    const seen = await peer.waitForEvent(
      'network:ipchanged',
      (d) => d.oldIP?.split(':')[0] === nodeIp && d.newIP?.split(':')[0] === movedIp,
      90000,
      { afterId: peerBaseline },
    );

    expect(seen.data.newIP.split(':')[0], 'the peer was told the new address').to.equal(movedIp);
    expect(await isUp(env.clients[idx], idA), 'and the app is still running').to.equal(true);
  });
});
