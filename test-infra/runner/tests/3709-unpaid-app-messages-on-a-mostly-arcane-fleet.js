/*
 * Unpaid app messages on a mostly Arcane fleet: ten Arcane nodes and two legacy.
 *
 * Every Arcane node holds the quorum through its ring, admits at its door and
 * passes on what it admits; every legacy node answers 503 at its door and still
 * holds what the Arcane nodes committed. A signed copy that reaches an Arcane
 * node after an unsigned copy of it was refused is taken; a paid message that
 * only an unauthenticated peer serves is taken; an unpaid one only such a peer
 * carries is stored on no Arcane node. The fleet and the checks are
 * framework/mixed-network.js.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { mixedFleet, mixedNetworkChecks } from '../framework/mixed-network.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const MIX = { legacy: [3, 9], observer: 4 };

describe('unpaid app messages on a mostly Arcane fleet', function () {
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
