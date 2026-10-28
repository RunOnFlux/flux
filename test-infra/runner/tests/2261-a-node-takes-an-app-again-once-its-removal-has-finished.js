// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitForAppInstalled, waitForCandidacy } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';

// A node removing an app is not offered it by its own spawner until the removal
// has finished, and is offered it again from then on.
//
// The app is known to one node only, which holds one of its two instances, so it
// is short throughout and that node's spawner considers it on every pass. The
// node holds it as one that its spawner has not picked in the last twelve hours:
// an app installed by its operator, or installed longer ago than that. Its spec is
// seeded near expiry, which the spawner never picks, the app installed directly,
// and the spec then given its normal expiry.
//
// The removal is held at its checkpoint after the app's containers are gone and
// before its row is deleted, for as many spawner passes as REMOVING_PASSES: the
// window in which the spawner sees an app it does not run, and the node still has
// it installed. Once released, the node installs the app again.

const NODES = 2;
const INSTANCES = 2;
const REMOVER = 0;
const BEFORE_ROW_DELETE = 'removal:beforeRowDelete';
const REMOVING_PASSES = 3;
// Below the spawner's allowance of 100 blocks, and with the block ticker off it
// never expires.
const UNPICKED_EXPIRE = 50;
const SPAWNABLE_EXPIRE = 22000;

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
      env, name: appName, instances: INSTANCES, compose: [component(appName)], expire: UNPICKED_EXPIRE,
    });
    await installOnNodes(env, app, [REMOVER]);
    const spawnable = remover().getLastEventId();
    await dbClient(REMOVER + 1).replaceGlobalAppSpec({ ...app.spec, expire: SPAWNABLE_EXPIRE });
    // the spawner reads it, and passes over it while the node runs it
    await waitForCandidacy(remover(), (d) => d.name === appName && d.stage === 'afterAlreadyHeldOrTried', 120000, { afterId: spawnable });
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
