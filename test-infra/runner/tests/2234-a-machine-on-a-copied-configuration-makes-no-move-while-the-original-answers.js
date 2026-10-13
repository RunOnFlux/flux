// weight: medium
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getJournal } from '../framework/daemon-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A second machine is started on a copy of a running node's configuration: the
// same collateral, and the running node's IP as its configured one. It has
// recorded no address of its own, so the configured IP is where it would have
// moved from - but the running node still answers there. It makes no move: it
// announces none and sends no confirmation, and the collision check holds it
// out of service.
//
// Node 1 runs on its own collateral; node 3 runs on a copy of node 1's
// configuration, joining once the fleet is up. Node 2 is a bystander that holds
// the events.

const LISTED = 0;
const BYSTANDER = 1;
const COPY = 2;

describe('a machine on a copied configuration makes no move while the original answers', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const client = (i) => env.clients[i];
  const ipOf = (i) => subnet.nodeIp(i + 1);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      deferredNodes: 1,
      collateralOf: { [COPY + 1]: LISTED + 1 },
      configuredIp: { [COPY + 1]: ipOf(LISTED) },
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await env.startNode(COPY);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('is held out of service, announces no move and sends no confirmation', async function () {
    this.timeout(360000);
    await waitFor(async () => (await client(COPY).getDOSState()).data?.dosState >= 100, {
      timeout: 300000, interval: 5000, label: 'the copy holds itself out of service',
    });

    const moves = await dbClient(BYSTANDER + 1).appStateEvents({ type: 'ipchanged' });
    expect(moves.map((event) => `${event.ip}>${event.data?.newIP}`), 'moves the bystander holds').to.deep.equal([]);
    const confirmations = await getJournal({ method: 'createconfirmationtransaction', sourceIp: ipOf(COPY) });
    expect(confirmations.total, 'confirmations the copy sent').to.equal(0);
  });
});
