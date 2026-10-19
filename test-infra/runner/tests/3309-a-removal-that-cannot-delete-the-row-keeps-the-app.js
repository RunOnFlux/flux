/*
 * A hard redeploy whose removal cannot delete the app's row fails, and the row stays,
 * still describing the app. Nothing deletes it later: the reconciler rebuilds the app
 * from it, and the node holds the app from then on.
 *
 * The node's first delete of a row is refused once, during the redeploy's removal.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { getAppContainerId, isAppContainerRunning } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { failCommands } from '../framework/mongo-control.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const HOLDER = 0;
// longer than any delay a background delete of the row could be scheduled at
const SETTLE_MS = 90000;

function step(what) {
  console.log(`# 3309 ${new Date().toISOString()} ${what}`);
}

describe('a removal that cannot delete the app\'s row keeps the app', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2erowkept${Date.now()}`;
  let holder;
  let release;
  let containerBefore;
  let redeployedAt;
  let failedDeletes;

  const holds = async () => (await holder.getInstalledApps()).data?.some((a) => a.name === appName) ?? null;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, tickerAutostart: false });
    await bootAndPeer(env);
    holder = env.clients[HOLDER];

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      env,
      name: appName,
      compose: [{
        name: appName,
        description: 'row kept test container',
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
    await installOnNodes(env, app, [HOLDER]);
    await waitFor(async () => Boolean(await getAppContainerId(holder.container, appName, appName)), {
      timeout: 120000, interval: 2000, label: 'the app runs before the redeploy',
    });
    containerBefore = await getAppContainerId(holder.container, appName, appName);

    const auth = await authenticate(holder.url, appOwnerKey());
    release = await failCommands(HOLDER + 1, 'localzelapps', 'zelappsinformation', { commands: ['findAndModify'], times: 1 });
    step('hard redeploy with the row delete refused once');
    const body = await holder.redeployApp(appName, auth.zelidauth, { force: true });
    redeployedAt = Date.now();
    if (/Unauthorized/i.test(body)) throw new Error(`hard redeploy refused: ${body.slice(0, 400)}`);
    failedDeletes = await release();
    release = null;
    step('redeploy returned');
  });

  after(async function () {
    this.timeout(60000);
    await release?.().catch(() => {});
    await env?.teardown();
  });

  it('had its delete of the app\'s row refused by the database', function () {
    expect(failedDeletes, 'the database refused none of the node\'s row deletes, so nothing below was tested').to.equal(1);
  });

  it('rebuilds the app from the row it kept', async function () {
    this.timeout(180000);
    await waitFor(async () => {
      const id = await getAppContainerId(holder.container, appName, appName);
      return Boolean(id) && id !== containerBefore && isAppContainerRunning(holder.container, appName);
    }, { timeout: 150000, interval: 2000, label: 'the app runs again in a new container' });
  });

  it('still holds the app once the removal is long over', async function () {
    this.timeout(SETTLE_MS + 60000);
    const wait = SETTLE_MS - (Date.now() - redeployedAt);
    if (wait > 0) await new Promise((resolve) => { setTimeout(resolve, wait); });
    expect(await holds(), 'the app\'s row was deleted after its removal had failed').to.equal(true);
    expect(await isAppContainerRunning(holder.container, appName), 'the app no longer runs').to.equal(true);
  });
});
