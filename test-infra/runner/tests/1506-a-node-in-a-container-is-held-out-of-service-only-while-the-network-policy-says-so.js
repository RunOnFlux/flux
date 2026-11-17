/*
 * A node whose FluxOS runs in a container reports it, and is held out of service
 * only while the signed network policy's `containerdos` document is true: it is
 * held once a bundle saying so reaches it, and released once one that does not
 * reaches it, with nothing restarted.
 *
 * Every harness node is a Docker container with a PID namespace of its own, so
 * the fixture is the product's own reading of a real container. The bundle
 * reaches the observed nodes the way production's does: one node polls the
 * published source and the rest adopt from their peers.
 *
 * That a node on a host or in a virtual machine is never held cannot be shown
 * here, where no node is either; the unit suite covers it.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { setPolicyDocuments } from '../framework/external-http-control.js';
import { waitFor, waitForDosChanged } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

// Three nodes is the smallest ring whose two halves stay disjoint: one node polls the
// source, and the other two can only have the bundle from a peer.
const NODES = 3;
const SOURCE_NODE = 0;
// Never index 0: every backward arc wraps onto it.
const OBSERVED = [1, 2];

const IN_CONTAINER = /running in a container/;

const containerRuntimeOf = async (client) => (await client.get(`/flux/info?_=${Date.now()}`))?.data?.flux?.containerRuntime;

describe('a node in a container is held out of service only while the network policy says so', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      tickerAutostart: false,
      nodeConfigOverrides: { [SOURCE_NODE]: { policy: { refreshIntervalMs: 5000 } } },
    });
    await bootAndPeer(env);
  });

  afterTeardown(async function () {
    await setPolicyDocuments({ containerdos: null }).catch(() => {});
    await env?.teardown();
  });

  it('reports that it runs in a container, and serves on while the policy does not hold it', async function () {
    this.timeout(120000);
    for (const index of OBSERVED) {
      const client = env.clients[index];
      // eslint-disable-next-line no-await-in-loop
      const status = await containerRuntimeOf(client);
      expect(status, `node ${index} reports no container runtime`).to.include({ inContainer: true, dosEnabled: false });
      expect(status.pidNamespace, `node ${index} reports the host's PID namespace`).to.not.equal(4026531836);
      // eslint-disable-next-line no-await-in-loop
      const dos = await client.get(`/flux/dosstate?_=${Date.now()}`);
      expect(dos?.data?.dosMessage ?? '', `node ${index} is held for its container under no policy`).to.not.match(IN_CONTAINER);
    }
  });

  it('is held out of service once a bundle turning the policy on reaches it', async function () {
    this.timeout(120000);
    const marks = OBSERVED.map((index) => env.clients[index].getLastEventId());
    const { seq } = await setPolicyDocuments({ containerdos: true });
    expect(seq, 'the publish returned a sequence').to.be.a('number');

    await Promise.all(OBSERVED.map((index, i) => waitForDosChanged(
      env.clients[index],
      (d) => d.dosState === 100 && IN_CONTAINER.test(d.dosMessage ?? ''),
      90000,
      { afterId: marks[i] },
    )));
    for (const index of OBSERVED) {
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => {
        const dos = await env.clients[index].get(`/flux/dosstate?_=${Date.now()}`);
        const status = await containerRuntimeOf(env.clients[index]);
        return dos?.data?.dosState === 100 && IN_CONTAINER.test(dos.data.dosMessage ?? '') && status?.dosEnabled === true;
      }, { timeout: 30000, interval: 2000, label: `node ${index}'s API reports it held for its container` });
    }
  });

  it('is released once a bundle turning the policy off reaches it', async function () {
    this.timeout(120000);
    const marks = OBSERVED.map((index) => env.clients[index].getLastEventId());
    await setPolicyDocuments({ containerdos: null });

    await Promise.all(OBSERVED.map((index, i) => waitForDosChanged(
      env.clients[index],
      (d) => !IN_CONTAINER.test(d.dosMessage ?? ''),
      90000,
      { afterId: marks[i] },
    )));
    for (const index of OBSERVED) {
      // eslint-disable-next-line no-await-in-loop
      const status = await containerRuntimeOf(env.clients[index]);
      expect(status, `node ${index} after the release`).to.include({ inContainer: true, dosEnabled: false });
    }
  });
});
