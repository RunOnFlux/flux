/*
 * Unpaid app messages on a fleet that is half Arcane: six Arcane nodes and six
 * legacy, alternating round the ring, so every Arcane node holds exactly the
 * quorum of Arcane peers. The same checks as 3709 (framework/mixed-network.js).
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { mixedFleet, mixedNetworkChecks } from '../framework/mixed-network.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const MIX = { legacy: [1, 3, 5, 7, 9, 11], observer: 4 };

describe('unpaid app messages on a half Arcane fleet', function () {
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
