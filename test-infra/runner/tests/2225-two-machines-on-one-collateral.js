// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { crashFluxos } from '../framework/container.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A second machine runs on a collateral the network already lists at a node that
// answers - a copy of the node started elsewhere. It holds itself out of service.
// Once the listed node stops answering, the second machine takes the collateral
// over, and the confirmation it sends puts its own address on the list. It was
// never at the old address, so it announces no move: the old node's rows are not
// its to carry.
//
// Node 1 runs on its own collateral; node 4 runs on node 1's, joining once the
// fleet is up. Node 2 is a bystander that reads the list and holds the events;
// it and node 3 are the peers the copy asks whether node 1 is gone, which takes
// two of them.

const LISTED = 0;
const BYSTANDER = 1;
const COPY = 3;

describe('two machines on one collateral', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const client = (i) => env.clients[i];
  const listedAddress = (i) => `${subnet.nodeIp(i + 1)}:16127`;
  // A list entry names its address bare when the port is the default.
  const socketOf = (ip) => (String(ip).includes(':') ? String(ip) : `${ip}:16127`);
  const collateralAt = async () => {
    const list = await client(BYSTANDER).get(`/daemon/viewdeterministiczelnodelist?_=${Date.now()}`);
    const collateral = (list.data || []).map((node) => socketOf(node.ip))
      .find((ip) => ip === listedAddress(LISTED) || ip === listedAddress(COPY));
    return collateral ?? null;
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      deferredNodes: 1,
      collateralOf: { [COPY + 1]: LISTED + 1 },
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

  it('holds the copy out of service while the listed node answers', async function () {
    this.timeout(360000);
    await waitFor(async () => (await client(COPY).getDOSState()).data?.dosState >= 100, {
      timeout: 300000, interval: 5000, label: 'the copy holds itself out of service',
    });
    expect(await collateralAt(), 'the collateral is still listed at the node that answers').to.equal(listedAddress(LISTED));
  });

  it('takes the collateral over once the listed node stops answering, and announces no move', async function () {
    this.timeout(480000);
    await crashFluxos(client(LISTED).container, { hold: true });

    await waitFor(async () => (await collateralAt()) === listedAddress(COPY), {
      timeout: 360000, interval: 5000, label: 'the collateral listed at the copy',
    });
    await waitFor(async () => (await client(COPY).getDOSState()).data?.dosState === 0, {
      timeout: 120000, interval: 5000, label: 'the copy back in service',
    });
    const moves = await dbClient(BYSTANDER + 1).appStateEvents({ type: 'ipchanged' });
    expect(moves.map((event) => `${event.ip}>${event.data?.newIP}`), 'moves the bystander holds').to.deep.equal([]);
  });
});
