// weight: heavy
/*
 * An app installed at specification version 3 is updated to a version that has
 * components. Nothing of the old app carries over, so the reinstall pass rebuilds it
 * from nothing: removed, and installed again at the new specification.
 *
 * On one node the rebuild completes, and the app runs at its new specification. On
 * another the database refuses the write of the new app's row, so the node no longer
 * holds the app and tells the network so; the pass goes on to the next app.
 *
 * The change arrives as in suite 85. The pass fires on
 * `blockHeight % (updateFluxAppsPeriod * speedMultiplier) === 0`, every 16 to 36
 * blocks here, so the drive is budgeted in blocks.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableLegacyApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes, seedSpecUpdate } from '../framework/reconciler-suite.js';
import { execInContainer, getAppContainerId } from '../framework/container.js';
import { waitFor, waitForComponentRedeployed } from '../framework/wait.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { failWrites } from '../framework/mongo-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const PASS_BLOCKS = 144;
const FAILS = 0;
const UPGRADES = 1;

function step(what) {
  console.log(`# 3307 ${new Date().toISOString()} ${what}`);
}

const component = (name, description) => ({
  name,
  description,
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

// The specification an old-format app is updated to: the one a new app of its name
// would carry, signed by its owner as an update.
async function upgradeOf(env, legacy) {
  const { name } = legacy.spec;
  const target = await buildSeedableApp({ env, name, instances: 1, compose: [component(name, `${name} upgraded`)] });
  return buildSeedableUpdate(legacy, (spec) => {
    Object.keys(spec).forEach((key) => { delete spec[key]; });
    const { hash, height, ...fields } = target.spec;
    Object.assign(spec, fields);
  });
}

// an app at specification version 3 has one container, named for the app alone
async function legacyContainerId(container, name) {
  const { stdout } = await execInContainer(container, `docker inspect --format '{{.Id}}' flux${name} 2>/dev/null || echo ""`);
  return stdout.trim() || null;
}

async function localSpec(client, name) {
  const res = await client.getInstalledApps();
  if (res.status !== 'success') return null;
  return (res.data ?? []).find((a) => a.name === name) ?? null;
}

describe('an app upgraded from the old format is rebuilt', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();
  const failing = `e2elegacyfail${stamp}`;
  const other = `e2elegacynext${stamp}`;
  const upgrading = `e2elegacyup${stamp}`;
  let upgraded;
  let release;
  let anchors;

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootAndPeer(env);

    await Promise.all([failing, upgrading, other].map((name) => pushImage(name, 'v1')));
    const legacyFailing = await buildSeedableLegacyApp({ env, name: failing });
    const legacyUpgrading = await buildSeedableLegacyApp({ env, name: upgrading });
    const otherApp = await buildSeedableApp({ env, name: other, instances: 1, compose: [component(other, `${other} first`)] });
    // in this order: the reinstall pass reaches the app it cannot rebuild first
    await installOnNodes(env, legacyFailing, [FAILS]);
    await installOnNodes(env, otherApp, [FAILS]);
    await installOnNodes(env, legacyUpgrading, [UPGRADES]);
    await waitFor(async () => Boolean(await legacyContainerId(env.clients[FAILS].container, failing))
      && Boolean(await getAppContainerId(env.clients[FAILS].container, other, other))
      && Boolean(await legacyContainerId(env.clients[UPGRADES].container, upgrading)), {
      timeout: 180000, interval: 2000, label: 'every app runs before its specification changes',
    });

    const failingUpgrade = await upgradeOf(env, legacyFailing);
    upgraded = await upgradeOf(env, legacyUpgrading);
    const otherUpdate = await buildSeedableUpdate(otherApp, (spec) => { spec.compose[0].description = `${other} second`; });
    anchors = env.clients.map((client) => client?.getLastEventId());
    await seedSpecUpdate(env, failingUpgrade, [FAILS]);
    await seedSpecUpdate(env, otherUpdate, [FAILS]);
    await seedSpecUpdate(env, upgraded, [UPGRADES]);
    await stopTicker();
    release = await failWrites(FAILS + 1, 'localzelapps', 'zelappsinformation', { times: 1 });
    step('the reinstall pass is due');
  });

  after(async function () {
    this.timeout(60000);
    await release?.().catch(() => {});
    await env?.teardown();
  });

  it('goes on to the next app in the same pass after one it could not rebuild', async function () {
    this.timeout(2400000);
    const node = env.clients[FAILS];
    const since = () => node.getEventBuffer().filter((e) => e.id > anchors[FAILS]);
    const failedRebuild = () => since().find((e) => e.event === 'app:rebuilt' && e.data.name === failing && e.data.outcome !== 'installed');
    const passEndAfter = (event) => since().find((e) => e.event === 'reinstall:passEnded' && e.id > event.id);
    await driveUntil(node, async () => Boolean(failedRebuild() && passEndAfter(failedRebuild())), {
      blocks: PASS_BLOCKS, label: 'a reinstall pass rebuilds the app, fails, and ends',
    });
    const rebuilt = failedRebuild();
    const ended = passEndAfter(rebuilt);
    const redeployed = since().find((e) => e.event === 'app:componentRedeployed' && e.data.name === other
      && e.id > rebuilt.id && e.id < ended.id);
    expect(redeployed, 'the pass stopped at the app it could not rebuild').to.not.equal(undefined);
  });

  it('tells the network it no longer holds the app it could not rebuild', async function () {
    this.timeout(120000);
    const node = env.clients[FAILS];
    const peers = env.clients.filter((client, i) => client && i !== FAILS);
    const heard = await Promise.any(peers.map((peer, i) => peer.waitForEvent(
      'network:appremoved',
      (d) => d.name === failing && d.ip.startsWith(node.ip),
      60000,
      { afterId: anchors[env.clients.indexOf(peer)] },
    ).then(() => i))).catch(() => null);
    expect(heard, 'no node was told the app had gone').to.not.equal(null);
  });

  it('had the write of the rebuilt app\'s row refused by the database', async function () {
    const failed = await release();
    release = null;
    expect(failed, 'the database refused none of the node\'s row writes, so nothing above was tested').to.equal(1);
  });

  it('rebuilds an app whose upgrade completes at its new specification', async function () {
    this.timeout(2400000);
    const node = env.clients[UPGRADES];
    const atNewSpec = async () => (await localSpec(node, upgrading))?.hash === upgraded.hash;
    await driveUntil(node, atNewSpec, { blocks: PASS_BLOCKS, label: 'the node rebuilds the app at its new specification' });
    const installed = await localSpec(node, upgrading);
    expect(installed.version, 'the app is not at its new specification version').to.equal(upgraded.spec.version);
    await waitFor(async () => Boolean(await getAppContainerId(node.container, upgrading, upgrading)), {
      timeout: 120000, interval: 2000, label: 'the rebuilt app runs as a component',
    });
  });
});
