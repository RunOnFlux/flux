import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { getAppContainerStatus } from '../framework/container.js';
import {
  reportPublicIp, clearReportedPublicIp, getJournal, clearJournal,
} from '../framework/daemon-control.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, seedAndInstall } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// When a node's public address moves, every app that stays has to come up on the
// new one. The app here is COMPOSED, and that is the whole fixture: a composed app
// has no container under its bare app name - its containers are
// `<component>_<app>` - so anything restarting it by that name resolves nothing.
// Both components must come back, which is only true if the restart is asked for
// per component.
//
// The address moves by changing what benchmark ANSWERS, not by renumbering the
// container: adjustExternalIP compares getpublicip against userconfig, so the node
// detects the change with its network untouched and every peer still reachable.
//
// Asserted on the reconciler's own actuations, because that is the property -
// the address change hands the surviving apps over as durable restart requests
// and the reconciler is what carries them out.

const COMPONENT_A = 'alpha';
const COMPONENT_B = 'beta';

async function isUp(client, identifier) {
  const status = await getAppContainerStatus(client.container, identifier);
  return Boolean(status && status.status.startsWith('Up'));
}

describe('a node whose address changed restarts the apps that stay', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  let nodeIp;
  let movedIp;
  const appName = `e2eipchg${Date.now()}`;
  const idA = `${COMPONENT_A}_${appName}`;
  const idB = `${COMPONENT_B}_${appName}`;

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);

    await pushImage(appName, 'v1');
    const component = (name, port) => ({
      name,
      description: 'address-change component',
      repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
      ports: [port],
      domains: [''],
      environmentParameters: [],
      commands: [],
      containerPorts: [80],
      containerData: '/tmp',
      cpu: 0.1,
      ram: 100,
      hdd: 1,
      repoauth: '',
    });
    const app = await buildSeedableApp({
      name: appName,
      compose: [component(COMPONENT_A, 31801), component(COMPONENT_B, 31802)],
    });
    idx = await seedAndInstall(env, app);
    nodeIp = subnet.nodeIp(idx + 1);
    // Inside the fleet's own subnet, so it is an address the node has no reason to
    // reject as malformed, and one no other node in the run occupies.
    movedIp = nodeIp.replace(/\.\d+$/, '.240');
  });

  after(async function () {
    this.timeout(60000);
    await clearReportedPublicIp(nodeIp).catch(() => {});
    await env?.teardown();
  });

  it('restarts every component of a composed app, not just the first', async function () {
    // The collision check that reads the address runs on a 60s cycle, and each
    // component's restart queues behind the reconciler's own pacing.
    this.timeout(300000);
    const client = env.clients[idx];

    await waitFor(async () => (await isUp(client, idA)) && (await isUp(client, idB)), {
      timeout: 120000,
      interval: 3000,
      label: 'both components running before the address moves',
    });

    // Baselines taken before the change, so a restart that had already happened
    // cannot be read as this one's.
    const after = client.getLastEventId();
    await clearJournal();

    await reportPublicIp(nodeIp, movedIp);

    // Both, each on its own identifier. Asserting only component A would pass on a
    // node that never reached component B, which is precisely the failure here.
    await waitForReconcileActuated(client, idA, 'restarted', 180000, { afterId: after });
    await waitForReconcileActuated(client, idB, 'restarted', 180000, { afterId: after });

    await waitFor(async () => (await isUp(client, idA)) && (await isUp(client, idB)), {
      timeout: 120000,
      interval: 3000,
      label: 'both components running again after the address moved',
    });
  });

  it('carries on past the apps to the work that follows them', async function () {
    // The apps are not the end of the handler: a confirmation transaction is sent
    // AFTER the loop that deals with them. An app-handling failure that escaped
    // the loop would take that with it, so the transaction arriving is what proves
    // the handler ran to the end rather than stopping at the first composed app.
    this.timeout(120000);
    const client = env.clients[idx];

    await waitFor(async () => {
      const journal = await getJournal({ method: 'createconfirmationtransaction', sourceIp: nodeIp });
      return journal.total > 0;
    }, { timeout: 90000, interval: 3000, label: 'the confirmation transaction that follows the app loop' });

    expect(await isUp(client, idA), 'and the app is still running').to.equal(true);
  });
});
