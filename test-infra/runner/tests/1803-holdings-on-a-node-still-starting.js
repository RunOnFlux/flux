import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// What a node answers about its holdings before it knows who anybody is.
//
// Establishing that a caller is a Fluxnode means reading the deterministic node list,
// and the accessors for that WAIT for the list to arrive - deliberately, because most
// callers cannot tell an unknown list from an empty one. A peer's monitor pass is the
// case that must not reach that wait: parked there, the request holds a handler open
// and the peer learns nothing until its own probe expires, which it then reads as this
// node being GONE rather than starting. Gone and starting are opposite instructions -
// one says promote, the other says wait, and the node still starting may be the one
// holding the only copy.
//
// So the node refuses, in milliseconds, and the refusal is the answer: alive, ask again.
//
// rpcFailures is the real condition rather than an imitation of it - the daemon stub
// answers every RPC from that node with "Loading block index...", so its network state
// genuinely never starts, for as long as the suite wants it. It is also the only way to
// reach this state: a node whose list has already arrived stays ready even if the
// daemon stops answering afterwards.

const subnet = getSubnetConfig();

const STARTING = 1; // daemon still warming, network state never starts
const READY = 0; // the control, to show the refusal is this node's state and not the route

const holdingsUrl = (index) => `http://${subnet.nodeIp(index + 1)}:16127/apps/promotedfolders`;

// The body is unsigned on purpose. The readiness refusal is owed to any caller, before
// the node looks at who is asking - which is the whole point, since working out who is
// asking is the thing it cannot do yet.
async function askForHoldings(index) {
  const startedAt = Date.now();
  const response = await fetch(holdingsUrl(index), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: subnet.nodeIp(index + 1), timestamp: Date.now(), pubKey: 'PUB', signature: 'SIG' }),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, elapsedMs: Date.now() - startedAt };
}

describe('holdings on a node that has not finished starting', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 2,
      tickerAutostart: false,
      rpcFailures: [subnet.nodeIp(STARTING + 1)],
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('refuses instead of parking the request', async function () {
    this.timeout(60000);
    const { status, elapsedMs } = await askForHoldings(STARTING);

    expect(status, 'a node that cannot say who anybody is must refuse, not answer').to.equal(503);
    // The probe that asks this in production gives up after 10s and files the node as
    // unreachable. Answering at all is the fix; answering promptly is what the fix is
    // FOR, so the bound is asserted rather than left to the status alone.
    expect(elapsedMs, `answered in ${elapsedMs}ms, which is not sooner than the probe gives up`).to.be.lessThan(10000);
  });

  // Without this the test above passes on a fleet where the route is broken, missing,
  // or refusing everywhere - none of which is the state it claims to be describing.
  it('answers the same call normally once the node knows the network', async function () {
    this.timeout(60000);
    const { status } = await askForHoldings(READY);

    expect(status, 'the control node refuses too, so 503 is not about readiness here').to.equal(200);
  });
});
