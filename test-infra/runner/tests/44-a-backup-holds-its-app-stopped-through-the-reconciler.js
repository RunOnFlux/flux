import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  getAppContainerStatus, restartDockerd, execInContainer, containerStartedAt,
} from '../framework/container.js';
import {
  setSynced, resetSyncState, resetFolderWrites, getPauseWrites,
} from '../framework/syncthing-control.js';
import { getSubnetConfig, REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { bootAndPeer, seedSyncthingApp, installOnNodes } from '../framework/reconciler-suite.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { waitForUp, waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

// A backup stops its app through the reconciler, which holds each component
// stopped while the archive is taken and keeps acting on it: a reconnect sweep
// fired by a dockerd restart mid-backup starts nothing the backup holds. Lifting
// the hold brings each component back where its other inputs put it - an
// operator-stopped one stays down - and FDM keeps routing to the node for the
// containers the backup took down, and for no other.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

const subnet = getSubnetConfig();

describe('a backup holds its app stopped through the reconciler', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eblease${Date.now()}`;
  let app;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetSyncState();
    // an r: app on its leader path: it starts immediately and uses syncthing,
    // so the backup flow takes the stop -> tar -> restart shape (the lease
    // window the reconciler must respect)
    app = await seedSyncthingApp(env, { name: appName, mode: 'r', index: 0 });
    await setSynced({ ip: subnet.nodeIp(1), folder: app.folder });
    await waitForUp(env.clients[0], appName, 'app running before backup');
    // bulk up appdata so the tar phase gives a real lease window
    // (FLUX_APPS_FOLDER relocates the apps dir in the harness image)
    const bulk = await execInContainer(
      env.clients[0].container,
      `sh -c "d=\\$(ls -d /mnt/appdata/flux-apps/flux${appName}* | head -1) && dd if=/dev/urandom of=\\$d/appdata/bulk.bin bs=1M count=200 && ls -l \\$d/appdata/bulk.bin"`,
    );
    if (bulk.exitCode !== 0) {
      throw new Error(`appdata bulk-up failed (lease window would be too small): ${bulk.stderr || bulk.output}`);
    }
  });

  afterTeardown(async function () {
    await resetSyncState().catch(() => {});
    await env?.teardown();
  });

  it('starts nothing the backup holds when a reconnect sweep runs mid-backup, and runs the app again after', async function () {
    this.timeout(300000);
    const client = env.clients[0];
    const auth = await authenticate(client.url, appOwnerKey());

    const heldBefore = await client.getDecisionCount('reconciler:held', app.identifier, 'operationHold');
    const afterId = client.getLastEventId();
    // not awaited: the unresolved promise is the backup's window
    const backupDone = client.appendBackupTask(appName, [appName], auth.zelidauth);
    const hold = await client.waitForEvent('reconciler:operationHold',
      (d) => d.identifier === app.identifier && d.held === true, 120000, { afterId });

    // the reconnect sweep, inside the window
    await restartDockerd(client.container);

    const body = await backupDone;
    expect(body).to.not.match(/Unauthorized/i);
    const release = client.getEventBuffer().find((e) => e.id > hold.id && e.event === 'reconciler:operationHold'
      && e.data?.identifier === app.identifier && e.data?.held === false);
    expect(release, 'the backup lifted its hold').to.not.equal(undefined);

    const startedWhileHeld = client.getEventBuffer().filter((e) => e.id > hold.id && e.id < release.id
      && e.event === 'reconciler:actuated' && e.data?.identifier === app.identifier
      && ['started', 'recreated', 'restarted'].includes(e.data?.action));
    expect(startedWhileHeld, 'the reconciler started what the backup held').to.deep.equal([]);
    // canary: with docker back, the reconciler met the stopped component and left
    // it down for the hold
    expect(await client.getDecisionCount('reconciler:held', app.identifier, 'operationHold'),
      'the reconciler kept it down for the backup').to.be.above(heldBefore);

    await waitFor(async () => isUp(client, appName), { timeout: 120000, interval: 3000, label: 'app running again once the backup lifted its hold' });
  });

  it('a monitor pass during the backup does not un-pause the folder it is holding', async function () {
    this.timeout(300000);
    const client = env.clients[0];
    const auth = await authenticate(client.url, appOwnerKey());
    // node numbers are 1-based in subnet-config (clients[0] is nodeIp(1)) - the
    // suite's own setSynced above uses the same offset. nodeIp(0) is .9, an
    // address nothing occupies, and its write log reads empty forever.
    const nodeIp = subnet.nodeIp(1);

    // the stub's write log is cumulative and the test above backed up this same
    // app on this same node, leaving a paused:true/paused:false pair in it. Read
    // unreset, that pair satisfies the hold-wait below before this test's backup
    // has taken any hold (making it vacuous) and then fails the assertion with
    // the PREVIOUS backup's legitimate resume. Suites 87 and 88 reset for the
    // same reason - the window has to be this test's own.
    await resetFolderWrites();

    // the unresolved promise is the lease window; the backup pauses the folder
    // inside it, and the app is held in backupInProgress for the whole run
    const backupDone = client.appendBackupTask(appName, [appName], auth.zelidauth);

    // the backup takes its hold - proves the window is real before we assert on it
    await waitFor(async () => (await getPauseWrites(nodeIp)).some((w) => w.id === app.folder && w.paused === true), {
      timeout: 120000, interval: 1000, label: 'backup paused the folder',
    });

    // taken AFTER the hold is observed, so the pass awaited below is one that
    // completed inside the window. Taken before the backup started, the wait
    // would be satisfied by a pass that finished before the folder was ever
    // paused - which proves a pass ran, not that one ran while it was held.
    const afterId = client.getLastEventId();

    // a real monitor pass runs inside the window (the event proves it ran, so the
    // assertion below is not vacuously green on a pass that never happened), and
    // its write set must not carry the held folder - un-pausing it mid-backup is
    // the propagated-deletion incident this whole change exists to prevent
    const pass = await client.waitForEvent('syncthing:passComplete', () => true, 120000, { afterId });
    expect(pass.data.wrote, 'the monitor pass must not write the folder a backup is holding')
      .to.not.include(app.folder);

    // and nothing un-paused it: the only pause writes for this folder in the
    // window are the backup's own, and no paused:false lands before the backup
    // itself resumes on release
    const pausesDuringHold = (await getPauseWrites(nodeIp)).filter((w) => w.id === app.folder);
    expect(pausesDuringHold.every((w) => w.paused === true), 'no un-pause of the held folder before release').to.equal(true);

    const body = await backupDone;
    expect(body).to.not.match(/Unauthorized/i);
    await waitFor(async () => isUp(client, appName), { timeout: 120000, interval: 3000, label: 'app running again after the hold released' });
  });

  it('leaves an operator-stopped component down through a backup, and routes only to what the backup took down', async function () {
    this.timeout(420000);
    const subject = 4;
    const client = env.clients[subject];
    const pair = `e2ebpair${Date.now()}`;
    const web = `web_${pair}`;
    const side = `side_${pair}`;
    const component = (name) => ({
      name,
      description: `${name} of ${pair}`,
      repotag: `${REGISTRY_REPO_HOST}/e2e-pause:v1`,
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
    const up = async (name) => (await getAppContainerStatus(client.container, name))?.status?.startsWith('Up') === true;
    await installOnNodes(env, await buildSeedableApp({
      name: pair, env, instances: 1, compose: [component('web'), component('side')],
    }), [subject]);
    await waitFor(async () => (await up(web)) && (await up(side)), { timeout: 180000, interval: 2000, label: 'both components run' });

    const owner = await authenticate(client.url, appOwnerKey());
    await client.getAuthed(`/apps/appstop/${side}`, owner.zelidauth);
    await waitFor(async () => !(await up(side)), { timeout: 120000, interval: 2000, label: 'the operator stopped one component' });
    const sideStartedAt = await containerStartedAt(client.container, `flux${side}`);

    const backupDone = client.appendBackupTask(pair, ['web'], owner.zelidauth);
    await waitFor(async () => !(await up(web)), { timeout: 120000, interval: 1000, label: 'the backup took the running component down' });
    const routed = (await client.get(`/apps/listrunningapps?_=${Date.now()}`)).data.map((c) => c.Names[0]);
    expect(routed, 'FDM is told the component the backup took down still runs').to.include(`/flux${web}`);
    expect(routed, 'FDM is told an operator-stopped component runs').to.not.include(`/flux${side}`);

    const body = await backupDone;
    expect(body).to.not.match(/Unauthorized|Refused/i);
    await waitFor(async () => up(web), { timeout: 120000, interval: 2000, label: 'the component the backup took down runs again' });
    expect(await containerStartedAt(client.container, `flux${side}`), 'the backup started a component its operator stopped')
      .to.equal(sideStartedAt);
    // canary: the reconciler decided about the operator-stopped one after the backup
    await waitFor(async () => (await client.getDecisionCount('reconciler:held', side, 'operatorStopped')) >= 1, {
      timeout: 120000, interval: 2000, label: 'the reconciler kept the operator-stopped component down',
    });
  });
});
