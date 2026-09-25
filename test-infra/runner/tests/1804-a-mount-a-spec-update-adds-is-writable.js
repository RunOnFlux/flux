// weight: heavy
/*
 * An owner's specification update adds mount directories to a running app, and
 * the application, running as a non-root user, can write to them.
 *
 * A directory a spec declares is created on the component's volume. When the
 * volume is created with the app, volume creation makes each one mode 777. When
 * a SPEC UPDATE adds one, the volume already exists and the soft redeploy creates
 * the directory while it builds the container, through ensureMountPathsExist -
 * a different path, which must leave it just as writable. Most published images
 * do not run as root, so a directory only root can write is a mount the app
 * cannot use.
 *
 * The app is the test-app image with its User set to 10000, and WRITE_PROBE makes
 * it write to each mount as its first act, exiting 73 if any refuses. So the
 * claim is checked from INSIDE the container, through the bind, as the user the
 * image names - the position a real game server is in. The directory's mode is
 * asserted beside it, because a failure there names the cause.
 *
 * The update changes containerData and the probe list and nothing else, so hdd is
 * untouched and this is the SOFT path: the component is reinstalled on the volume
 * it already has, and what the app wrote before the update is still there after
 * it. That is asserted too - it is what makes adding a mount by update safe.
 *
 * Both forms are added: `m:` (a directory replicated like the rest of the volume)
 * and `ml:` (one kept off the network). The primary is unreplicated here, so the
 * two differ only in what the parser records; each is still a directory the
 * update creates on an existing volume.
 *
 * Triggered and driven exactly as suite 85: the app's global row is replaced by a
 * seeded update, and blocks drive the periodic reinstall pass.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes, seedSpecUpdate } from '../framework/reconciler-suite.js';
import { execInContainer, getAppContainerId } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { driveUntil, stopTicker } from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const APP_USER = '10000';
const ADDED = [
  { subdir: 'added', mount: '/added', form: 'm' },
  { subdir: 'kept', mount: '/kept', form: 'ml' },
];
const CONTAINER_DATA_AFTER = `/tmp|${ADDED.map((d) => `${d.form}:${d.subdir}:${d.mount}`).join('|')}`;

describe('a mount directory a specification update adds is writable by the app\'s own user', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2emntupd${Date.now()}`;
  const containerName = `flux${appName}_${appName}`;
  const volume = `/mnt/appdata/flux-apps/${containerName}`;
  const marker = `${volume}/appdata/written-before-the-update`;
  let holder;
  let app;
  let updated;
  let containerBefore;

  const sh = async (command) => execInContainer(holder.container, command);
  const appLogs = async () => (await sh(`docker logs ${containerName} 2>&1; true`)).stdout;

  async function localSpec(client) {
    const res = await client.getInstalledApps();
    if (res.status !== 'success') return null;
    return (res.data ?? []).find((a) => a.name === appName) ?? null;
  }

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 5, tickerAutostart: false });
    await bootAndPeer(env);
    [holder] = env.clients;
    await pushTestApp(appName, 'v1', 'testapp', { user: APP_USER });
    app = await buildSeedableApp({
      env,
      name: appName,
      instances: 1,
      compose: [{
        name: appName,
        description: 'mount added by spec update',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        // The probe's positive arm: the primary the volume was created with is
        // writable as this user, so a failure after the update is the update's.
        environmentParameters: ['WRITE_PROBE=/tmp'],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
    await installOnNodes(env, app, [0]);
    await waitFor(async () => {
      containerBefore = await getAppContainerId(holder.container, appName, appName);
      return Boolean(containerBefore) && (await appLogs()).includes(`write probe ok: /tmp (uid ${APP_USER})`);
    }, { timeout: 120000, interval: 2000, label: `the app runs as uid ${APP_USER} and writes to its primary mount` });

    const written = await sh(`echo kept > ${marker} && cat ${marker}`);
    expect(written.stdout.trim(), 'the app volume takes a write before the update').to.equal('kept');
    const absent = await sh(`ls -d ${ADDED.map((d) => `${volume}/${d.subdir}`).join(' ')} 2>/dev/null; true`);
    expect(absent.stdout.trim(), 'the directories the update adds do not exist before it').to.equal('');

    updated = await buildSeedableUpdate(app, (spec) => {
      spec.compose[0].containerData = CONTAINER_DATA_AFTER;
      spec.compose[0].environmentParameters = [`WRITE_PROBE=/tmp,${ADDED.map((d) => d.mount).join(',')}`];
    });
    expect(updated.hash, 'an update that hashes the same is not an update').to.not.equal(app.hash);
    await seedSpecUpdate(env, updated, [0]);
    // The only advancer from here: see suite 85 on why a second one settles the
    // node's tip on one parity and the reinstall pass never fires.
    await stopTicker();
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('reinstalls the component on the volume it already had', async function () {
    // Budgeted in blocks, as suite 85 is: 108 covers three firings of the pass
    // at its longest period.
    this.timeout(1500000);
    await driveUntil(
      holder,
      async () => (await localSpec(holder))?.hash === updated.hash,
      { blocks: 108, label: 'the node installs the app at the new specification' },
    );
    const installed = await localSpec(holder);
    expect(installed.compose[0].containerData).to.equal(CONTAINER_DATA_AFTER);
    await waitFor(async () => {
      const containerAfter = await getAppContainerId(holder.container, appName, appName);
      return Boolean(containerAfter) && containerAfter !== containerBefore;
    }, { timeout: 120000, interval: 2000, label: 'the component is replaced at the new specification' });

    const kept = await sh(`cat ${marker}`);
    expect(kept.stdout.trim(), 'what the app wrote before the update is still on its volume').to.equal('kept');
  });

  it('creates each added mount directory mode 777', async function () {
    this.timeout(60000);
    for (const { subdir } of ADDED) {
      // eslint-disable-next-line no-await-in-loop
      const stat = await sh(`stat -c '%F %a' ${volume}/${subdir}`);
      expect(stat.stdout.trim(), `${subdir} is a directory any container user can write`).to.equal('directory 777');
    }
  });

  it(`lets the app, running as uid ${APP_USER}, write to every added mount`, async function () {
    this.timeout(180000);
    // The probe runs first thing at every start and the reconciler restarts a
    // container that exits, so its log accumulates a line per mount per start.
    // Waiting for an ok per mount, then reading for any refusal, answers both ways.
    await waitFor(async () => {
      const logs = await appLogs();
      return ADDED.every(({ mount }) => logs.includes(`write probe ok: ${mount} (uid ${APP_USER})`))
        || logs.includes('write probe failed');
    }, { timeout: 150000, interval: 3000, label: 'the updated app reports a write to each added mount' });
    const logs = await appLogs();
    expect(logs, 'no mount refused the app\'s user').to.not.include('write probe failed');
    for (const { mount } of ADDED) {
      expect(logs).to.include(`write probe ok: ${mount} (uid ${APP_USER})`);
    }
    const state = await sh(`docker inspect --format '{{.State.Running}} {{.State.ExitCode}}' ${containerName}`);
    expect(state.stdout.trim(), 'the app is running, not stopped by a refused write').to.equal('true 0');
  });
});
