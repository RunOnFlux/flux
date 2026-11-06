/*
 * A peer's text frame that parses to anything but a message ends that peer's
 * connection, as an invalid message, and the node carries on: the same process
 * serves, and takes the peer back when it dials again.
 *
 * Each case's canary is the close code. A node that stopped takes the connection
 * down with it and the stub sees 1006, not an invalid-message close.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODES = 3;
const STUB = 2;
const TARGET = 0;

describe('a frame that is no message costs its sender the connection and nothing else', function () {
  let env;
  let stub;
  let client;
  let target;

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this, nodes: NODES, stubPeers: [STUB], stubPeeredWith: { [STUB]: [TARGET] },
    });
    await bootAndPeer(env);
    stub = env.stubPeerClients.get(STUB);
    client = env.clients[TARGET];
    target = getSubnetConfig().nodeIp(TARGET + 1);
    await waitFor(async () => (await stub.getStats()).connectionsOpen >= 1,
      { timeout: 120000, interval: 1000, label: 'the stub connected' });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  ['null', `T${Date.now()}|null`, '[]', '1'].forEach((frame) => {
    it(`closes the connection that sent ${frame}, and the node carries on`, async function () {
      this.timeout(180000);
      const mark = client.getLastEventId();
      const sentAt = Date.now();

      expect(await stub.sendFrame(frame), 'the frame reached no node').to.be.at.least(1);

      await client.waitForEvent('peers:removed', (d) => d.ip === stub.ip, 60000, { afterId: mark });
      const { closes } = await stub.getStats();
      const codes = closes.filter((c) => c.ip === target && c.at >= sentAt).map((c) => c.code);
      expect(codes, JSON.stringify(closes)).to.have.length(1);
      expect(codes[0], 'closed as an invalid message, inbound or outbound').to.be.oneOf([4016, 4017]);

      await waitFor(async () => {
        if ((await stub.getStats()).connectionsOpen >= 1) return true;
        await stub.dialLinks([`${target}:16127`]).catch(() => {});
        return false;
      }, { timeout: 90000, interval: 3000, label: 'the node takes the peer back' });
    });
  });
});
