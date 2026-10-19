/*
 * A hard redeploy whose removal cannot delete the app's row stops with the app part
 * removed: its containers and volume are gone, its row is not. The node holds it as
 * departing - never announced - and runs the removal again until it finishes, then
 * tells the network it no longer holds the app.
 *
 * The node's deletes of the row are refused REFUSED times: the redeploy's removal and
 * the next runs of it, so the app is held across at least one announcement. A second
 * app on the node is in every announcement, which shows announcements went out.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { getAppContainerId } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { failCommands } from '../framework/mongo-control.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const HOLDER = 0;
// each run of the removal waits 15s after the last, and the node announces every ~30s
const REFUSED = 4;

function step(what) {
  console.log(`# 3309 ${new Date().toISOString()} ${what}`);
}

const component = (name) => ({
  name,
  description: 'part removal test container',
  repotag: `${REGISTRY_REPO_HOST}/${name}:v1`,
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
});

describe('a removal that stops part way is finished', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();
  const appName = `e2epartremoved${stamp}`;
  const otherName = `e2epartother${stamp}`;
  let holder;
  let release;
  let anchors;
  let failedAt;

  const holds = async (name) => (await holder.getInstalledApps()).data?.some((a) => a.name === name) ?? null;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, tickerAutostart: false });
    await bootAndPeer(env);
    holder = env.clients[HOLDER];

    await Promise.all([appName, otherName].map((name) => pushImage(name, 'v1')));
    const app = await buildSeedableApp({ env, name: appName, compose: [component(appName)] });
    const other = await buildSeedableApp({ env, name: otherName, compose: [component(otherName)] });
    await installOnNodes(env, app, [HOLDER]);
    await installOnNodes(env, other, [HOLDER]);
    await waitFor(async () => Boolean(await getAppContainerId(holder.container, appName, appName))
      && Boolean(await getAppContainerId(holder.container, otherName, otherName)), {
      timeout: 120000, interval: 2000, label: 'both apps run before the redeploy',
    });

    const auth = await authenticate(holder.url, appOwnerKey());
    release = await failCommands(HOLDER + 1, 'localzelapps', 'zelappsinformation', { commands: ['findAndModify'], times: REFUSED });
    step(`hard redeploy with the row delete refused ${REFUSED} times`);
    const body = await holder.redeployApp(appName, auth.zelidauth, { force: true });
    if (/Unauthorized/i.test(body)) throw new Error(`hard redeploy refused: ${body.slice(0, 400)}`);
    anchors = env.clients.map((client) => client?.getLastEventId());
    failedAt = holder.getLastEventId();
    step('redeploy returned');
  });

  after(async function () {
    this.timeout(60000);
    await release?.().catch(() => {});
    await env?.teardown();
  });

  it('no longer holds the app once its removal finishes', async function () {
    this.timeout(240000);
    await waitFor(async () => (await holds(appName)) === false, {
      timeout: 210000, interval: 2000, label: 'the node no longer holds the app',
    });
  });

  it('had its deletes of the app\'s row refused by the database', async function () {
    const failed = await release();
    release = null;
    expect(failed, 'the database refused none of the node\'s row deletes, so nothing here was tested').to.be.at.least(1);
  });

  it('never announces the app once its removal has stopped part way', function () {
    const announcements = holder.getEventBuffer().filter((e) => e.id > failedAt && e.event === 'app:running');
    expect(
      announcements.some((e) => e.data.apps?.some((a) => a.name === otherName)),
      'the node announced nothing while the app was held, so nothing here was tested',
    ).to.equal(true);
    expect(
      announcements.filter((e) => e.data.apps?.some((a) => a.name === appName)).length,
      'the node announced an app it had part removed',
    ).to.equal(0);
  });

  it('tells the network it no longer holds the app', async function () {
    this.timeout(90000);
    const peers = env.clients.filter((client, i) => client && i !== HOLDER);
    const heard = await Promise.any(peers.map((peer) => peer.waitForEvent(
      'network:appremoved',
      (d) => d.name === appName && d.ip.startsWith(holder.ip),
      60000,
      { afterId: anchors[env.clients.indexOf(peer)] },
    ))).catch(() => null);
    expect(heard, 'no node was told the app had gone').to.not.equal(null);
  });
});
