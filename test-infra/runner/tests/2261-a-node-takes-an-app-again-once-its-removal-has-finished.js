// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, seedSpawnerApp, installedInstanceIndices } from '../framework/reconciler-suite.js';
import { waitFor, waitForAppInstalled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';

// A node removing an app is not offered it by its own spawner until the removal
// has finished, and is offered it again from then on. The app asks for more
// instances than the fleet has nodes, so it is short throughout and the spawner
// considers it on every pass.
//
// The removal is held at its checkpoint after the app's containers are gone and
// before its row is deleted, for as many spawner passes as REMOVING_PASSES: the
// window in which the spawner sees an app it does not run, and the node still has
// it installed. Once released, the app is installed again by the node that
// removed it - the only node that can take it.

const NODES = 2;
const INSTANCES = 3;
const REMOVER = 0;
const BEFORE_ROW_DELETE = 'removal:beforeRowDelete';
const REMOVING_PASSES = 3;

const component = (name) => ({
  name,
  description: 'removal and spawn test container',
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

describe('a node takes an app again once its removal has finished', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eretake${Date.now()}`;
  const remover = () => env.clients[REMOVER];
  // Every spawner pass that reaches the candidate filters tallies one verdict
  // for each app the network is short of.
  const passes = async () => Object.values((await remover().getTestCounters())?.['spawner:verdict']?.[appName] ?? {})
    .reduce((sum, n) => sum + n, 0);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await bootAndPeer(env);
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      env, name: appName, instances: INSTANCES, compose: [component(appName)],
    });
    await seedSpawnerApp(env, app);
    await waitFor(async () => (await installedInstanceIndices(env, appName)).length === NODES, {
      timeout: 600000, interval: 5000, label: 'every node took the app',
    });
  });

  after(async function () {
    this.timeout(60000);
    await remover()?.releaseAllCheckpoints().catch(() => {});
    await env?.teardown();
  });

  it('is installed again by the node that removed it', async function () {
    this.timeout(900000);
    const from = remover().getLastEventId();
    await remover().holdCheckpoint(BEFORE_ROW_DELETE, appName);
    const auth = await authenticate(remover().url, fluxTeamKey());
    const removal = remover().removeAppLocally(appName, auth.zelidauth).catch(() => null);
    await remover().waitForEvent('checkpoint:held', (d) => d.name === BEFORE_ROW_DELETE && d.key === appName, 180000, { afterId: from });

    const passesBefore = await passes();
    await waitFor(async () => (await passes()) - passesBefore >= REMOVING_PASSES, {
      timeout: 300000, interval: 2000, label: `${REMOVING_PASSES} spawner passes while the removal is held`,
    });

    const released = remover().getLastEventId();
    await remover().releaseCheckpoint(BEFORE_ROW_DELETE, appName);
    await removal;
    await remover().waitForEvent('app:removed', (d) => d.name === appName, 120000, { afterId: released });

    const installed = await waitForAppInstalled(remover(), appName, 600000, { afterId: released }).catch(() => null);
    expect(installed, 'the node that removed the app took it again while it was short').to.not.equal(null);
  });
});
