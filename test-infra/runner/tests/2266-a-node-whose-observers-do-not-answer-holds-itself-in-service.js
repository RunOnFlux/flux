import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { crashFluxos, releaseFluxos } from '../framework/container.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node asks its peers whether they can reach it. A peer that does not answer at
// all - its FluxOS down - says nothing about the node that asked, and is not asked
// again in that pass. With every other node down, the node asks each once, learns
// nothing, and holds no reachability verdict against itself.
//
// Three nodes: the subject's only observers are the other two, and both are held
// down, so every observer it can draw is silent.

const SUBJECT = 1;
const OBSERVERS = [0, 2];
const REACHABILITY_MESSAGES = [
  'Flux communication is limited, other nodes on the network cannot reach yours through API calls',
  'Flux is not available for outside communication',
];
const PASS_MS = 180000;

describe('a node whose observers do not answer holds itself in service', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const client = (i) => env.clients[i];
  let held = [];

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await client(SUBJECT).waitForEvent('availability:checked', (d) => d.available === true, 240000);
    await Promise.all(OBSERVERS.map((i) => crashFluxos(client(i).container, { hold: true })));
    held = OBSERVERS;
  });

  after(async function () {
    this.timeout(300000);
    if (env) await Promise.all(held.map((i) => releaseFluxos(client(i).container).catch(() => {})));
    await env?.teardown();
  });

  it('holds no reachability verdict against itself on the passes that find every observer silent', async function () {
    this.timeout(3 * PASS_MS);
    const node = client(SUBJECT);
    let anchor = node.getLastEventId();
    // eslint-disable-next-line no-restricted-syntax
    for (const pass of [1, 2]) {
      // eslint-disable-next-line no-await-in-loop
      const checked = await node.waitForEvent('availability:checked', () => true, PASS_MS, { afterId: anchor });
      anchor = checked.id;
      expect(checked.data.available, `pass ${pass} reached a verdict`).to.equal(false);
      expect(REACHABILITY_MESSAGES, `pass ${pass}'s dos message`).to.not.include(checked.data.dosMessage);
      expect(checked.data.dosState, `pass ${pass}'s dos state`).to.equal(0);
    }
    const dos = (await node.getDOSState()).data;
    expect(REACHABILITY_MESSAGES).to.not.include(dos.dosMessage);
    expect(dos.dosState).to.equal(0);
  });
});
