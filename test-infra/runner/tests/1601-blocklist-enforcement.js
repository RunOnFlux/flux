import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { pushImage } from '../framework/registry-helper.js';
import { stopTicker } from '../framework/daemon-control.js';
import { setBlocklist } from '../framework/external-http-control.js';
import {
  waitForBlockProcessed, waitForAppSpecStored, waitForAppInstalled, waitForAppRemoved,
  restartFluxosAndAwaitRecovery,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { dbClient } from '../framework/db-client.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';

const REGISTRY = REGISTRY_REPO_HOST;

// Three nodes is the smallest ring whose two halves stay disjoint, and this suite
// needs no more: one node to host the application and two to demonstrate that
// nobody takes it back afterwards.
const NODES = 3;

// The only node whose backstop tick is compressed. Every other node is left at production's
// 24 hours, so anything they hold came to them from a peer rather than from the source.
const SOURCE_NODE = 0;

describe('Blocklist enforcement over the published policy document', function () {
  let env;
  let hostIndex = -1;
  const appName = `e2eBlocked${Date.now()}`;
  const repoName = 'blocklist-app';
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      tickerAutostart: false,
      // ONE node polls the source, and it is deliberately not the whole fleet.
      //
      // The blocklist arrives in the signed bundle now, so what brings a newly published
      // document to a node is the policy backstop tick - and at production's 24 hours
      // nothing in a test window waits for it. Compressing it on EVERY node would make each
      // one fetch for itself, and the suite would prove only that a node can read a URL.
      // Left at 24 hours everywhere but node 0, what reaches the other two can only have
      // come from a peer, which is the path production actually uses.
      nodeConfigOverrides: { [SOURCE_NODE]: { policy: { refreshIntervalMs: 15000 } } },
    });
    await pushImage(repoName, 'v1');
    await bootAndPeer(env);

    const spec = buildAppSpec({
      name: appName,
      instances: 1,
      compose: [{
        name: appName,
        description: 'application the policy document will later refuse',
        repotag: `${REGISTRY}/${repoName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
    const result = await registerAndConfirm(env.clients[0].url, nodeKey(1), spec, env.clients);
    expect(result.status).to.equal('success');
    await waitForBlockProcessed(env.clients[0], (d) => d.height >= result.targetHeight, 60000);
    await waitForAppSpecStored(env.clients[0], appName);

    // Whichever node draws it first. The suite asserts about the fleet, so which
    // one it is does not matter - only that the application is really installed
    // before the document names it.
    const installed = await Promise.any(
      env.clients.map((client, index) => waitForAppInstalled(client, appName, 240000)
        .then(() => index)),
    );
    hostIndex = installed;
    expect(hostIndex).to.be.gte(0);
  });

  after(async function () {
    this.timeout(60000);
    await setBlocklist([]).catch(() => {});
    await stopTicker().catch(() => {});
    await env?.teardown();
  });

  it('removes an installed application once the document names it', async function () {
    this.timeout(300000);
    // Named by application name for two reasons, and the second one is what keeps
    // this suite honest.
    //
    // A non-extending update is free to an owner and mints a new hash, so a hash
    // names one version where a name names the application.
    //
    // And `name` is the only kind the flat document cannot express: name entries
    // are omitted from its projection, and a bare application name there would be
    // tested against the hash, the owner, the repository and the namespace, which
    // it matches none of. So the typed document is the ONLY thing that can satisfy
    // this test. If a node ever stops reading it - an unpublished document, an
    // unsigned one, a bundle that does not carry it - the fallback answers with
    // nothing blocked, the application is never removed, and test 1 fails on its
    // wait.
    //
    // A case added here with kind `image` or `org` gives that up: the fallback can
    // express both, so it would stand in silently and the suite would pass while
    // proving the road not taken.
    const { seq } = await setBlocklist([{
      kind: 'name',
      value: appName,
      reason: 'suite 100',
      added: '2026-09-12',
    }]);
    expect(seq, 'the publish returned a sequence to converge on').to.be.a('number');

    // Every node is restarted, not only the host: the other two would otherwise still be
    // working from the empty document and would take the application back the moment it
    // went short.
    //
    // The restart is no longer what makes a node SEE the new document - there is no
    // per-node fetch cache to clear, since the blocklist now arrives in the signed bundle.
    // The compressed backstop tick above is what brings it, and the restart is only here to
    // put every node on the same footing.
    for (const client of env.clients) {
      // eslint-disable-next-line no-await-in-loop
      await restartFluxosAndAwaitRecovery(client, { recoveryTimeoutMs: 180000 });
    }

    await waitForAppRemoved(env.clients[hostIndex], appName, 240000);

    // WHERE IT CAME FROM, not just that it arrived. Only SOURCE_NODE polls the published
    // source; every other node sits at production's 24 hours and cannot have fetched
    // anything inside this test. So a node other than SOURCE_NODE holding the new sequence
    // has been handed it by a peer, which is the path the fleet actually uses and the one a
    // fleet-wide compressed tick would have hidden by letting every node fetch for itself.
    const heldSeq = async (index) => (await dbClient(index + 1).policyBundle())?.seq ?? null;
    const viaPeers = [];
    for (let i = 0; i < NODES; i += 1) {
      if (i === SOURCE_NODE) continue;
      // eslint-disable-next-line no-await-in-loop
      if (await heldSeq(i) === seq) viaPeers.push(i);
    }
    expect(viaPeers, `no node reached seq ${seq} except the one that polls the source`)
      .to.not.be.empty;
  });

  it('drops it from the candidate pool rather than drawing and refusing it', async function () {
    this.timeout(180000);
    // The application is now short of its one instance, which is the state the
    // candidate aggregation looks for, so every node reconsiders it. The verdict
    // names the stage that took it: asserting on that is a positive signal the
    // filter ran, where watching a window for an absent install would pass just
    // as well on a spawner that never woke up.
    const verdict = await Promise.any(
      env.clients.map((client) => client.waitForEvent(
        'spawner:candidacy',
        (d) => d.name === appName && d.stage === 'afterBlocklist',
        150000,
      )),
    );
    expect(verdict.data.candidate).to.equal(false);
  });

  it('does not let any node take it back', async function () {
    this.timeout(60000);
    // Every node has now published its verdict, so a re-install would have to
    // contradict one already recorded.
    env.clients.forEach((client, index) => {
      const installed = client.getEventBuffer().filter(
        (e) => e.event === 'app:installed' && e.data.name === appName,
      );
      const removed = client.getEventBuffer().filter(
        (e) => e.event === 'app:removed' && e.data.name === appName,
      );
      expect(installed.length).to.be.at.most(
        removed.length,
        `node ${index + 1} installed a blocked application more often than it removed it`,
      );
    });
  });
});
