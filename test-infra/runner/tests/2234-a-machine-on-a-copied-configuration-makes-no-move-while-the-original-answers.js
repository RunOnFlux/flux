// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { configuredIpOf, crashFluxos } from '../framework/container.js';
import { getJournal } from '../framework/daemon-control.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A second machine is started on a copy of a running node's configuration: the
// same collateral, and the running node's IP as its configured one. It has
// recorded no address of its own, so the configured IP is where it would have
// moved from. While the running node answers there it makes no move: it
// announces none and sends no confirmation, and the collision check holds it
// out of service. Once the running node is gone the copy takes the collateral
// over, but it never ran the running node's app, so it announces no move and
// carries no row of that app to its own address.
//
// Node 1 runs on its own collateral and runs an app; node 4 runs on a copy of
// node 1's configuration, joining once the fleet is up. Node 2 is a bystander
// that reads the list and holds the events. Node 3 is a third node at start,
// which the fleet needs to obtain the network policy an install waits for.

const LISTED = 0;
const BYSTANDER = 1;
const COPY = 3;
// The running node's row has to outlive its crash and the copy's takeover, or
// the absence of a carried row would prove nothing.
const LOCATION_TTL_S = 30 * 60;

describe('a machine on a copied configuration makes no move while the original answers', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2ecopiedconfig${Date.now()}`;
  const client = (i) => env.clients[i];
  const ipOf = (i) => subnet.nodeIp(i + 1);
  const listedAddress = (i) => `${ipOf(i)}:16127`;
  // A list entry names its address bare when the port is the default.
  const socketOf = (ip) => (String(ip).includes(':') ? String(ip) : `${ip}:16127`);
  const collateralAt = async () => {
    const list = await client(BYSTANDER).get(`/daemon/viewdeterministiczelnodelist?_=${Date.now()}`);
    return (list.data || []).map((node) => socketOf(node.ip))
      .find((ip) => ip === listedAddress(LISTED) || ip === listedAddress(COPY)) ?? null;
  };
  const movesHeld = async () => (await dbClient(BYSTANDER + 1).appStateEvents({ type: 'ipchanged' }))
    .map((event) => `${event.ip}>${event.data?.newIP}`);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      deferredNodes: 1,
      collateralOf: { [COPY + 1]: LISTED + 1 },
      configuredIp: { [COPY + 1]: ipOf(LISTED) },
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1, locationTtlS: LOCATION_TTL_S } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      instances: 1,
      compose: [{
        name: 'alpha',
        description: 'copied configuration',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
    await installOnNodes(env, app, [LISTED]);
    await waitFor(async () => (await dbClient(BYSTANDER + 1).getAppLocationsByIp(listedAddress(LISTED)))
      .some((row) => row.name === appName), {
      timeout: 180000, interval: 3000, label: 'the bystander holds the running node\'s app at its address',
    });
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

    expect(await movesHeld(), 'moves the bystander holds').to.deep.equal([]);
    const confirmations = await getJournal({ method: 'createconfirmationtransaction', sourceIp: ipOf(COPY) });
    expect(confirmations.total, 'confirmations the copy sent').to.equal(0);
  });

  it('takes the collateral over once the running node is gone, announcing no move and carrying none of its rows', async function () {
    this.timeout(600000);
    await crashFluxos(client(LISTED).container, { hold: true });

    await waitFor(async () => (await collateralAt()) === listedAddress(COPY), {
      timeout: 480000, interval: 5000, label: 'the collateral listed at the copy',
    });

    expect(await movesHeld(), 'moves the bystander holds').to.deep.equal([]);
    const atCopy = await dbClient(BYSTANDER + 1).getAppLocationsByIp(listedAddress(COPY));
    expect(atCopy.map((row) => row.name), 'rows the bystander holds at the copy').to.not.include(appName);
    expect(await configuredIpOf(client(COPY).container), 'the copy\'s configured IP').to.equal(ipOf(COPY));
  });
});
