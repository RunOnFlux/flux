// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { redirectOutbound, clearOutboundRedirect, getAppContainerStatus } from '../framework/container.js';
import { electMaster, clearMaster, resetFdm } from '../framework/fdm-control.js';
import {
  waitFor, waitForReconcileActuated, waitForUp, waitForElectionDecisions, electionDecisionCount,
} from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import { isDaemonUp, listFolderFiles } from '../framework/syncthing-real.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A single-writer app on two nodes, the primary running it and the standby
// holding a copy. The standby has proven who is at the primary's address, and
// holds that for as long as production does. Then its calls to the primary start
// landing on a third node, which holds no copy and says so truthfully - between
// the standby asking whether the primary holds the component and the answer
// coming back.
//
// That third node's "not held" is a clearance to start a second writer. The
// identity the standby proved a moment ago is of the address, not of this answer,
// so the answer has to prove itself.
//
// A = the standby, B = the primary, C = the node A's calls to B reach instead.

const A = 0;
const B = 1;
const C = 2;

const FLUX_PORTS = '16127:16129';
const PEER_PROBE = 'masterSlave:beforePeerProbe';

// As long as production holds a verified identity, so nothing here re-asks who is
// at the primary's address while the test runs.
const VERIFIED_TTL_MS = 30 * 60 * 1000;
// How long a misrouted verdict is held, so the fixed route is noticed within a
// pass or two.
const MISROUTED_TTL_MS = 10000;

const appDir = (name) => `/mnt/appdata/flux-apps/flux${name}_${name}`;

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('a verified peer whose calls are redirected between the question and the answer', function () {
  let env;
  let redirectRules = [];
  dumpLogsOnFailure(() => env);

  const appName = `e2eproven${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const addr = (i) => `${env.clients[i].ip}:16127`;

  // Sampled for the whole suite, not only where it waits: at most one node runs
  // the component.
  const bothRan = [];
  let sampler = null;

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          peerIdentityVerifiedTtlMs: VERIFIED_TTL_MS,
          peerIdentityMisroutedTtlMs: MISROUTED_TTL_MS,
        },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await resetFdm();
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });

    await electMaster(appName, env.clients[B].ip);
    const primaryAfter = env.clients[B].getLastEventId();
    await installOnNodes(env, app, [B]);
    await waitForReconcileActuated(env.clients[B], identifier, 'dataCleared', 120000, { afterId: primaryAfter });
    await seedSyncScopedData(env, appName, B);
    await waitForUp(env.clients[B], appName, 'the primary is running', { timeout: 180000, interval: 3000 });

    const standbyAfter = env.clients[A].getLastEventId();
    await installOnNodes(env, app, [A]);
    await waitForReconcileActuated(env.clients[A], identifier, 'dataCleared', 120000, { afterId: standbyAfter });

    sampler = setInterval(() => {
      Promise.all([isUp(env.clients[A], appName), isUp(env.clients[B], appName)])
        .then(([a, b]) => { if (a && b) bothRan.push(Date.now()); })
        .catch(() => {});
    }, 2000);
  });

  after(async function () {
    this.timeout(60000);
    clearInterval(sampler);
    await env?.clients[A].releaseAllCheckpoints().catch(() => {});
    if (env && redirectRules.length) await clearOutboundRedirect(env.clients[A].container, redirectRules).catch(() => {});
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('proves who is at the primary\'s address, and holds a copy of its data', async function () {
    this.timeout(300000);
    await waitFor(
      async () => (await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(B), 'verified')) > 0,
      { timeout: 180000, interval: 3000, label: 'the standby verified the primary' },
    );
    await waitFor(
      async () => (await listFolderFiles(env.clients[A], `${appDir(appName)}/appdata`)).split(' ').includes('seed-data'),
      { timeout: 240000, interval: 5000, label: 'the primary\'s data reached the standby' },
    );
    // The standby has read the primary off FDM, so it knows which node it must not
    // start alongside once FDM goes quiet.
    await waitForElectionDecisions(env.clients[A], identifier, 'primaryObserved', 1, { timeout: 60000 });
  });

  it('does not start on "not held" from the node its calls now reach, however recently it proved the primary', async function () {
    this.timeout(420000);
    expect(await isUp(env.clients[B], appName), 'precondition: the primary is running').to.equal(true);
    const misroutesAt = await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(B), 'misrouted');
    const decisions = () => Promise.all(['peerMisrouted', 'started']
      .map((decision) => electionDecisionCount(env.clients[A], identifier, decision)));
    const [misroutedAt, startedAt] = await decisions();

    // The standby's next question to the primary is held open with FDM quiet,
    // the redirect goes in, and then the question is let go.
    const from = env.clients[A].getLastEventId();
    await env.clients[A].holdCheckpoint(PEER_PROBE, addr(B));
    await clearMaster(appName);
    await env.clients[A].waitForEvent('checkpoint:held', (d) => d.name === PEER_PROBE && d.key === addr(B), 300000, { afterId: from });
    redirectRules = await redirectOutbound(env.clients[A].container, {
      toIps: [env.clients[B].ip], ports: FLUX_PORTS, landsOn: env.clients[C].ip, resetOpen: true,
    });
    await env.clients[A].releaseCheckpoint(PEER_PROBE, addr(B));

    // Decided either way: the probe knew the answer was not the primary's, or the
    // standby started.
    await waitFor(async () => {
      const [misrouted, started] = await decisions();
      return misrouted > misroutedAt || started > startedAt;
    }, { timeout: 120000, interval: 2000, label: 'the standby decided on the answer to the question it had held' });
    const [misrouted, started] = await decisions();

    expect(started, 'the standby started a second writer').to.equal(startedAt);
    expect(misrouted, 'the standby knew the answer came from another node').to.be.above(misroutedAt);
    expect(await env.clients[A].getDecisionCount('peerIdentity:verdict', addr(B), 'misrouted'),
      'the misroute the answer showed is held for the standby\'s other callers').to.be.above(misroutesAt);
    expect(await isUp(env.clients[A], appName), 'the standby is running the component').to.equal(false);
    expect(await isUp(env.clients[B], appName), 'the primary is still running').to.equal(true);
  });

  it('reads the primary\'s own signed answer once its calls reach it again, and stays standby', async function () {
    this.timeout(300000);
    const heldAt = await electionDecisionCount(env.clients[A], identifier, 'heldOnPeer');
    const startedAt = await electionDecisionCount(env.clients[A], identifier, 'started');
    await clearOutboundRedirect(env.clients[A].container, redirectRules);
    redirectRules = [];

    await waitForElectionDecisions(env.clients[A], identifier, 'heldOnPeer', 2, { from: heldAt, timeout: 180000 });

    expect(await electionDecisionCount(env.clients[A], identifier, 'started'), 'the standby started a second writer').to.equal(startedAt);
    expect(await isUp(env.clients[A], appName), 'the standby is running the component').to.equal(false);
    expect(await isUp(env.clients[B], appName), 'the primary is still running').to.equal(true);
    expect(bothRan, 'moments when both nodes ran the component').to.deep.equal([]);

    await electMaster(appName, env.clients[B].ip);
  });
});
