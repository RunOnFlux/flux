import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
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

  // Both nodes are read at the same moment, because the difference under test is
  // their state and not how long the suite has been running. The wait is for the
  // control node to finish starting - networkStateService.start() sits well down
  // serviceManager's chain, past the daemon poll the fleet boot waits on, so a node
  // seconds old has legitimately not got there yet and refusing then is correct.
  it('refuses while it cannot say who anybody is, and answers once it can', async function () {
    this.timeout(180000);
    await waitFor(async () => (await askForHoldings(READY)).status === 200, {
      timeout: 150000, interval: 5000, label: 'the control node finishes starting and answers the holdings call',
    });

    const control = await askForHoldings(READY);
    const starting = await askForHoldings(STARTING);

    // The control is what stops the refusal reading as a broken route, a missing
    // handler, or a fleet where nothing answers: same call, same moment, one of each.
    expect(control.status, 'a node that knows the network must answer').to.equal(200);
    expect(starting.status, 'a node that cannot say who anybody is must refuse, not answer').to.equal(503);
    // The probe that asks this in production gives up after 10s and files the node as
    // unreachable. Answering at all is the fix; answering PROMPTLY is what the fix is
    // for, so the bound is asserted rather than left to the status alone.
    expect(starting.elapsedMs, `refused after ${starting.elapsedMs}ms, no sooner than the probe gives up`).to.be.lessThan(10000);
  });
});
