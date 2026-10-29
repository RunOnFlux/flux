/*
 * A frame from a peer that the node cannot handle is dropped, and the node runs on: the same
 * FluxOS process, answering as before. A frame that is not a message at all is an invalid message,
 * and the node closes that peer for it; a peer-list message whose lists are not lists is ignored,
 * and the node keeps the connection and acts on the next message the peer sends.
 *
 * A peer stub puts each frame on its sockets exactly as given. Frames on one socket are handled in
 * order, so the node recording a well-formed claim sent after a frame says it has finished with the
 * frame. Every test starts with the stub connected to every real node.
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

// FluxPeerSocket CLOSE_CODES.INVALID_MSG_INBOUND / INVALID_MSG_OUTBOUND
const INVALID_MESSAGE = [4016, 4017];

// Frames that are no message: the node treats each as an invalid message.
const NOT_MESSAGES = ['null', '[]', '5', '"text"'];
// Peer-list messages whose lists are not lists: read as empty.
const BAD_LISTS = [
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
  // A closed connection is dialled again: the stub keeps asking every real node to dial it.
  const stubConnectedToEveryNode = () => waitFor(async () => (await stub.connectedNodes()) === REAL.length, {
    timeout: 180000, interval: 2000, label: 'every real node holds a connection to the stub',
  });
  const sendToEveryNode = async (frame) => {
    const sent = await stub.sendRaw([frame]);
    expect(sent.sent, 'nodes the frame was sent to').to.equal(REAL.length);
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

    await stubConnectedToEveryNode();
    pids = await pidsNow();
    expect(pids.every((pid) => typeof pid === 'number'), `FluxOS running on every node: ${pids}`).to.equal(true);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  for (const frame of NOT_MESSAGES) {
    it(`closes the peer that sent ${frame} as an invalid message, and runs on`, async function () {
      this.timeout(300000);
      await stubConnectedToEveryNode();
      const mark = subject.getLastEventId();
      await sendToEveryNode(frame);

      const closed = await subject.waitForEvent('peers:removed', (d) => d.ip === stubIp, 60000, { afterId: mark });
      expect(INVALID_MESSAGE, `close code ${closed.data.closeCode}`).to.include(closed.data.closeCode);
      expect(await pidsNow(), 'FluxOS processes').to.deep.equal(pids);
      expect((await subject.request('GET', '/flux/version')).status, 'the subject answers').to.equal(200);
    });
  }

  for (const frame of BAD_LISTS) {
    it(`ignores ${frame}, keeps the peer and acts on the message after it`, async function () {
      this.timeout(300000);
      await stubConnectedToEveryNode();
      await sendToEveryNode(frame);
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
