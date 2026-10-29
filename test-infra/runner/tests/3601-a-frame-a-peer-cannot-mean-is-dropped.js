/*
 * A frame from a peer that the node cannot handle is dropped: the node keeps running on the same
 * FluxOS process, keeps the peer's connection, and acts on the next message the peer sends.
 *
 * A peer stub puts each frame on its sockets exactly as given - JSON that is not an object, a
 * peer-list message whose lists are not lists - and then a well-formed claim on the same
 * connection. Frames on one socket are handled in order, so the node recording the claim is what
 * says it has finished with the frame before it.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer, seedGlobalSpec } from '../framework/reconciler-suite.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { fluxosPid } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// Three real nodes and a stub peer every one of them dials.
const STUB = 3;
const REAL = [0, 1, 2];
const SUBJECT = 1;

const FRAMES = [
  'null',
  '[]',
  '5',
  '"text"',
  '{"type":"peerExchange","outbound":5}',
  '{"type":"peerUpdate","addOutbound":5,"rm":{"length":2}}',
];

describe('a frame a peer cannot mean is dropped', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2erawframe${Date.now()}`;
  const stubIp = subnet.nodeIp(STUB + 1);
  let stub;
  let subject;
  let pids;

  const pidsNow = () => Promise.all(REAL.map((i) => fluxosPid(env.clients[i].container)));
  // The time of the stub's claim on the app as the subject holds it, or null.
  const claimHeld = async () => {
    const res = await subject.get(`/apps/installinglocations?_=${Date.now()}`);
    const claim = (res?.data ?? []).find((entry) => entry.name === appName && String(entry.ip).split(':')[0] === stubIp);
    return claim ? new Date(claim.broadcastedAt).getTime() : null;
  };

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this, nodes: 4, stubPeers: [STUB], tickerAutostart: false,
    });
    await bootAndPeer(env);
    subject = env.clients[SUBJECT];
    stub = env.stubPeerClients.get(STUB);

    // An app the claims can name.
    const app = await buildSeedableApp({ env, name: appName, instances: 1 });
    await seedGlobalSpec(env, app, REAL);

    await waitFor(async () => (await stub.connectedNodes()) === REAL.length, {
      timeout: 120000, interval: 2000, label: 'every real node holds a connection to the stub',
    });
    pids = await pidsNow();
    expect(pids.every((pid) => typeof pid === 'number'), `FluxOS running on every node: ${pids}`).to.equal(true);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  for (const frame of FRAMES) {
    it(`drops ${frame} and acts on the message after it`, async function () {
      this.timeout(120000);
      const sent = await stub.sendRaw([frame]);
      expect(sent.sent, 'nodes the frame was sent to').to.equal(REAL.length);
      const broadcastedAt = Date.now();
      await stub.claimApp(appName, { broadcastedAt });

      await waitFor(async () => (await claimHeld()) === broadcastedAt, {
        timeout: 60000, interval: 1000, label: `the subject holds the claim sent after ${frame}`,
      });
      expect(await pidsNow(), 'FluxOS processes').to.deep.equal(pids);
      expect(await stub.connectedNodes(), 'connections to the stub').to.equal(REAL.length);
    });
  }
});
