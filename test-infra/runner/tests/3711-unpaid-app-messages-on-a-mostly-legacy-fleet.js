/*
 * Unpaid app messages on a mostly legacy fleet: five Arcane nodes and seven
 * legacy. Node 0 is Arcane and its ring holds one Arcane peer, node 4; nodes 5,
 * 6 and 7 are Arcane, outside node 0's ring, each in a /16 of its own. Node 0
 * reaches the quorum only by the pass that holds authenticated links: node 4
 * reports its authenticated peers, node 0 marks them and dials them. Then the
 * same checks as 3709 (framework/mixed-network.js).
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { mixedFleet, mixedNetworkChecks } from '../framework/mixed-network.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// node 0's ring: 1-4 and 10-11; 5, 6 and 7 sit outside it, each in its own /16
const MIX = {
  legacy: [1, 2, 3, 8, 9, 10, 11], observer: 4, ipGroups: { 5: 1, 6: 2, 7: 3 },
};

describe('unpaid app messages on a mostly legacy fleet', function () {
  let env;
  const checks = mixedNetworkChecks(() => env, MIX);

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({ hookCtx: this, ...mixedFleet(MIX) });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('holds the quorum at node 0 through Arcane nodes its Arcane peer reported', async function () {
    this.timeout(120000);
    const { outbound, inbound } = await env.clients[0].getTestState('peers');
    const linked = new Set([...outbound, ...inbound].filter((peer) => peer.authenticated).map((peer) => peer.ip));
    const reported = [5, 6, 7].map((i) => env.clients[i].ip);
    expect([...linked].sort(), 'node 0\'s authenticated links').to.include.members(reported);
  });

  it('admits at every Arcane node\'s door and answers 503 at every legacy one, and every node then holds what was admitted', async function () {
    this.timeout(300000);
    const admitted = await checks.doorAdmitsOnlyOnArcaneNodes();
    expect(admitted, 'nothing was admitted').to.not.be.empty;
    await checks.everyNodeHolds(admitted);
  });

  it('takes a signed copy that arrives after an unsigned one was refused', async function () {
    this.timeout(120000);
    await checks.signedCopyAfterAnUnsignedOneIsTaken();
  });

  it('takes a paid message that only an unauthenticated peer serves', async function () {
    this.timeout(240000);
    await checks.paidMessageThroughLegacyOnlyIsTaken();
  });

  it('stores an unpaid message that only an unauthenticated peer carries on no Arcane node', async function () {
    this.timeout(120000);
    await checks.unpaidMessageThroughLegacyOnlyIsStoredNowhere();
  });
});
