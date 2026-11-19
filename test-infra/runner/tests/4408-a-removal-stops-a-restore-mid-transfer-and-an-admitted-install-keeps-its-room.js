/*
 * A removal stops a restore wherever its work is, and an install admitted to the node keeps its
 * room before it has a row:
 * - a restore downloading its archive is stopped by a removal: the download is closed and the app
 *   removed;
 * - a restore unpacking its archive is stopped by a removal, its component is not started while
 *   the removal runs, and the app is removed;
 * - on a node with room for one of two apps, the second app is declined while the first app's
 *   install is admitted and has not yet written its row, and the first then installs.
 *
 * The download is held by the external stub, which sends part of the archive and keeps the rest
 * until released or until the node closes the transfer. The unpack is a tar the test sees in the
 * node and freezes, so it cannot end before the removal stops it. The install is held at its
 * checkpoint after admission.
 *
 * The subject is node 2 of three (the ring needs three), a cumulus node with 25 GB left for apps:
 * a cumulus disk is 240 GB, 228 usable, and 203 are reserved for the system. An app of 12 GB
 * takes 14 with the 2 GB filesystem minimum, so one fits and two do not.
 */
import {
  describe, it, before, afterEach,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { isAppContainerRunning, execInContainer } from '../framework/container.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { deliverApp } from '../framework/app-delivery.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import {
  ORIGINAL, writeAppdata, localArchiveOf, restoreLocal,
} from '../framework/restore-fixture.js';
import {
  stageArtifact, artifactUrl, artifactTransfers, releaseArtifact,
} from '../framework/external-http-control.js';
import { authenticate } from '../auth.js';
import { appOwnerKey, fluxTeamKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const ROOM_FOR_ONE = { lockedSystemResources: { hdd: 0, extrahdd: 203 } };

describe('a removal meets a restore mid-transfer, and admission', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const SUBJECT = 1;
  const client = () => env.clients[SUBJECT];
  const ownerAuth = async () => (await authenticate(client().url, appOwnerKey())).zelidauth;
  const teamAuth = async () => (await authenticate(client().url, fluxTeamKey())).zelidauth;
  const stalled = [];

  async function placedApp(tag) {
    const appName = `e2e${tag}${ts}`;
    const app = await buildSeedableApp({ name: appName, env, instances: 1 });
    await installOnNodes(env, app, [SUBJECT]);
    await waitForUp(client(), appName, `${appName} runs`, { timeout: 180000, interval: 2000 });
    await writeAppdata(client(), appName, appName, ORIGINAL);
    return appName;
  }

  async function removed(appName) {
    await waitFor(async () => !(await isAppContainerRunning(client().container, appName)), {
      timeout: 120000, interval: 2000, label: `${appName} is removed`,
    });
  }

  function preempted(appName, operation, mark) {
    return client().waitForEvent('app:operationPreempted', (d) => d.appName === appName && d.operation === operation && d.by === 'removal', 120000, { afterId: mark });
  }

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      nodeTiers: { [SUBJECT + 1]: 'CUMULUS' },
      nodeConfigOverrides: { [SUBJECT]: ROOM_FOR_ONE },
    });
    await bootAndPeer(env);
  });

  // a case that fails while it holds something leaves the next case nothing held
  afterEach(async function () {
    await client()?.releaseAllCheckpoints();
    await Promise.all(stalled.splice(0).map((name) => releaseArtifact(name).catch(() => {})));
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('stops a restore\'s download for a removal, closes the transfer, and removes the app', async function () {
    this.timeout(900000);
    const appName = await placedApp('restoredownload');
    // small enough for the stub's control API, larger than what it sends before holding
    const archive = await execInContainer(client().container,
      'rm -rf /tmp/pub && mkdir -p /tmp/pub && head -c 48K /dev/urandom > /tmp/pub/big.bin '
      + '&& tar -czf - -C /tmp/pub . | base64 -w0 && rm -rf /tmp/pub');
    expect(archive.exitCode, `building the archive failed: ${archive.output}`).to.equal(0);
    const name = `${appName}-held`;
    const staged = await stageArtifact(name, archive.stdout.trim(), { stallAfter: 16 * 1024 });
    expect(staged.ok, `staging the artifact failed: ${JSON.stringify(staged)}`).to.equal(true);
    stalled.push(name);

    const restoring = client().appendRestoreTask(appName, [{ component: appName, restore: true, url: artifactUrl(name) }], 'remote', await ownerAuth());
    restoring.catch(() => {});
    await waitFor(async () => (await artifactTransfers(name)).some((t) => t.stalled && !t.clientClosed), {
      timeout: 180000, interval: 500, label: `the restore of ${appName} is downloading`,
    });

    const mark = client().getLastEventId();
    const removing = client().removeAppLocally(appName, await ownerAuth());
    removing.catch(() => {});
    await preempted(appName, 'restore', mark);

    expect(await restoring, 'the restore').to.include(`${appName}: stopped for its removal`);
    const transfers = await artifactTransfers(name);
    expect(transfers.every((t) => t.clientClosed && !t.released), `the downloads: ${JSON.stringify(transfers)}`).to.equal(true);
    await removing;
    await removed(appName);
  });

  it('stops a restore\'s unpack for a removal, starts nothing while it runs, and removes the app', async function () {
    this.timeout(900000);
    const appName = await placedApp('restoreunpack');
    const identifier = `${appName}_${appName}`;
    // incompressible, so the unpack is still running when the test freezes it
    const built = await execInContainer(client().container,
      `rm -rf /tmp/big && mkdir -p /tmp/big && head -c 400M /dev/urandom > /tmp/big/big.bin && mkdir -p "$(dirname ${localArchiveOf(appName)})" `
      + `&& tar -czf ${localArchiveOf(appName)} -C /tmp/big . && rm -rf /tmp/big`);
    expect(built.exitCode, `building the archive failed: ${built.output}`).to.equal(0);

    // the bracket keeps the pattern from matching the shell that runs pgrep or pkill
    const UNTAR = '"[t]ar -xzf"';
    const unpacking = async () => (await execInContainer(client().container, `pgrep -f ${UNTAR}`)).exitCode === 0;
    const restoring = restoreLocal(client(), appName, [appName], await ownerAuth());
    restoring.catch(() => {});
    await waitFor(unpacking, { timeout: 180000, interval: 200, label: `the restore of ${appName} is unpacking` });
    // Frozen, the unpack cannot finish on its own: only the restore's stop ends it.
    const frozen = await execInContainer(client().container, `pkill -STOP -f ${UNTAR}`);
    expect(frozen.exitCode, 'the unpack had ended before it was frozen').to.equal(0);

    const mark = client().getLastEventId();
    const removing = client().removeAppLocally(appName, await ownerAuth());
    removing.catch(() => {});
    try {
      await preempted(appName, 'restore', mark);
      expect(await restoring, 'the restore').to.include(`${appName}: stopped for its removal`);
    } finally {
      // a stop sent to a frozen process is delivered when it resumes
      await execInContainer(client().container, `pkill -CONT -f ${UNTAR}`);
    }
    await waitFor(async () => !(await unpacking()), { timeout: 120000, interval: 500, label: 'the unpack is ended' });
    await removing;
    await removed(appName);

    const started = client().getEventBuffer().filter((e) => e.id > mark && e.event === 'reconciler:actuated'
      && e.data?.identifier === identifier && e.data?.action === 'started');
    expect(started, 'the component was started between the stopped restore and its removal').to.have.lengthOf(0);
  });

  it('declines a second app while the first app\'s admitted install has no row, then installs the first', async function () {
    this.timeout(900000);
    const sized = (name) => buildSeedableApp({
      name,
      env,
      instances: 1,
      compose: [{
        name,
        description: 'admission test container',
        repotag: `${REGISTRY_REPO_HOST}/e2e-pause:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 12,
        repoauth: '',
      }],
    });
    const first = await sized(`e2eadmitted${ts}`);
    const second = await sized(`e2edeclined${ts}`);
    await deliverApp(env, first, [SUBJECT]);
    await deliverApp(env, second, [SUBJECT]);

    await client().holdCheckpoint('install:afterAdmission', first.spec.name);
    const mark = client().getLastEventId();
    const installingFirst = client().installAppLocally(first.spec.name, await teamAuth());
    installingFirst.catch(() => {});
    await client().waitForEvent('checkpoint:held', (d) => d.name === 'install:afterAdmission' && d.key === first.spec.name, 180000, { afterId: mark });

    const answer = await client().installAppLocally(second.spec.name, await teamAuth());
    expect(answer, 'the second install').to.include('Insufficient space on Flux Node to spawn an application');
    expect(await isAppContainerRunning(client().container, second.spec.name), 'the declined app runs').to.equal(false);

    await client().releaseCheckpoint('install:afterAdmission', first.spec.name);
    await installingFirst;
    await waitForUp(client(), first.spec.name, `${first.spec.name} runs once released`, { timeout: 180000, interval: 2000 });
  });
});
