import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { getSubnetConfig } from '../framework/subnet-config.js';

const subnet = getSubnetConfig();

// A node whose fluxd is still loading its block index must not report that its
// SYNCTHING is broken.
//
// The two are unrelated, and the node used to conflate them. Health was stamped
// healthy when the module loaded and the sentinel - the only thing that probes
// syncthing - started behind an unbounded wait for daemon RPC. A daemon slow to
// warm up therefore outlived the stamp, and the node answered /id/loginphrase
// with "Syncthing is not running properly" while nothing had ever looked at
// syncthing at all. fluxbench, which polls that endpoint, reported the node as
// failing for a reason that was not true.
//
// rpcFailures is the real condition rather than an imitation of it: the daemon
// stub answers every RPC from this node with code -28, "Loading block index...",
// which is exactly what waitForDaemonRpc loops on.
//
// Legacy, because the syncthing term only decides fitness on nodes whose
// syncthing FluxOS owns. On Arcane it is carved out and this suite would pass
// without running the branch.
const NODE = 1;

// The window is four missed passes of the sentinel loop, so both are shortened
// together - shortening the window alone would let a healthy node go stale
// between two good probes. Same ratio as production, a twelfth of the duration.
const SENTINEL_INTERVAL_MS = 5000;
const HEALTH_WINDOW_MS = 20000;

let env;
let node;

describe('Node health: a daemon still warming is not a syncthing fault', function () {
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(180000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 1,
      legacyNodes: [0],
      tickerAutostart: false,
      rpcFailures: [subnet.nodeIp(NODE)],
      configOverrides: {
        syncthing: {
          healthWindowMs: HEALTH_WINDOW_MS,
          sentinelIntervalMs: SENTINEL_INTERVAL_MS,
        },
      },
    });
    [node] = env.clients;

    // The API listens before startFluxFunctions runs, which is the whole reason
    // this window is reachable: the node is answering questions throughout.
    await waitFor(
      async () => (await node.get('/flux/health').catch(() => null))?.status !== undefined,
      { timeout: 120000, interval: 2000, label: 'node answering /flux/health' },
    );

    // Past the point the old fabricated stamp would have gone stale. There is no
    // marker to wait for - the daemon never becomes ready in this fleet and the
    // thing under test is what the node says while that is true - so the elapsed
    // window IS the condition, not a stand-in for one.
    await sleepUnlessInfraDead(HEALTH_WINDOW_MS + SENTINEL_INTERVAL_MS * 2);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('keeps the node fit while its daemon is still loading the block index', async function () {
    const health = await node.get('/flux/health');
    const phrase = await node.get('/id/loginphrase');

    expect(health.status, 'the node refused itself over a daemon that had not warmed up yet').to.equal('success');
    expect(phrase.status, 'fluxbench would read this as a node failure').to.equal('success');
  });

  it('never blames syncthing for it', async function () {
    const phrase = await node.get('/id/loginphrase');

    expect(JSON.stringify(phrase)).to.not.match(/Syncthing is not running properly/);
  });

  // The other half, and a different regression: measuring syncthing must not
  // itself wait on the daemon. If the sentinel is started below the daemon wait
  // this node never measures at all, and the check reads 'unmeasured' for as
  // long as fluxd takes - which on a node with a broken daemon is for ever.
  it('has actually measured syncthing, rather than having never looked', async function () {
    const health = await node.get('/flux/health');

    expect(health.data.syncthing, 'syncthing was never probed, because measuring it waited on the daemon').to.equal('ok');
  });
});
