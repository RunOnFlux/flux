/*
 * A holder of a single-writer (g:) app whose volume image is gone holds nothing of
 * the app's data. A standby in that state is rebuilt on a fresh volume, which syncs
 * the primary's data again; a primary in that state gives the app up, and the standby
 * takes it over with every file it held.
 *
 * Real syncthing: the data that comes back to the rebuilt standby, and the files the
 * standby keeps while the primary goes, are syncthing's own. The image is removed and
 * its mount dropped under a running FluxOS, which learns of the unmount as it happens,
 * and while FluxOS is down, which finds it gone when it starts: a node that lost the
 * disk holding it, rebooted.
 *
 * Each test places an app of its own on the same holders, so no test starts from what
 * another left.
 *
 * A = the standby, B = the primary, C holds nothing.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import {
  bootSilentPrimaryFleet, placeSilentPrimaryAppOn, A, B,
} from '../framework/silent-primary.js';
import { execInContainer, crashFluxos, releaseFluxos } from '../framework/container.js';
import { clearMaster } from '../framework/fdm-control.js';
import { scanFolder, listFolderFiles } from '../framework/syncthing-real.js';
import { destroyFolderVolume } from '../framework/volume-fixture.js';
import { waitFor, waitForAppRemoved, assertNoEvent } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const SIGTERM_EXPIRY_S = 120;
const FILES = ['one', 'two', 'three'];

describe('a g: app holder whose volume is gone is rebuilt, or gives the app up', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();
  const placed = [];
  const client = (i) => env.clients[i];
  const appdataOf = (appName) => `/mnt/appdata/flux-apps/flux${appName}_${appName}/appdata`;
  const filesOn = async (i, appName) => (await listFolderFiles(client(i), appdataOf(appName))).split(' ').filter(Boolean);
  const holdsEveryFile = async (i, appName) => {
    const held = await filesOn(i, appName);
    return ['seed-data', ...FILES].every((name) => held.includes(name));
  };

  // An app of the test's own: B runs it, A holds every file B wrote.
  async function placeApp(appName) {
    const app = await placeSilentPrimaryAppOn(env, appName);
    placed.push(app);
    const wrote = await execInContainer(client(B).container, FILES.map((name) => `printf '${name}' > ${appdataOf(appName)}/${name}`).join(' && '));
    expect(wrote.exitCode, `fixture: ${wrote.output}`).to.equal(0);
    await scanFolder(client(B), `flux${appName}_${appName}`);
    await waitFor(() => holdsEveryFile(A, appName), { timeout: 240000, interval: 3000, label: `the standby holds every file of ${appName}` });
    return app;
  }

  before(async function () {
    this.timeout(600000);
    env = await bootSilentPrimaryFleet({ hookCtx: this, sigtermExpiryS: SIGTERM_EXPIRY_S });
  });

  after(async function () {
    this.timeout(60000);
    placed.forEach((app) => app.stop());
    await env?.teardown();
  });

  it('rebuilds a standby whose volume is unmounted under a running FluxOS, as it goes', async function () {
    this.timeout(900000);
    const appName = `e2elostrun${stamp}`;
    const app = await placeApp(appName);
    const beforeLoss = client(A).getLastEventId();
    await destroyFolderVolume(client(A).container, `flux${appName}_${appName}`);

    // Within a minute: the hourly sweep is not what finds it.
    const decision = await client(A).waitForEvent('app:lostVolume', (d) => d.identifier === app.identifier, 60000, { afterId: beforeLoss });
    expect(decision.data.action, `the standby decided: ${JSON.stringify(decision.data)}`).to.equal('rebuild');
    await client(A).waitForEvent('app:componentRedeployed', (d) => d.name === appName && d.hard === true, 300000, { afterId: beforeLoss });
    await waitFor(() => holdsEveryFile(A, appName), { timeout: 300000, interval: 3000, label: 'the rebuilt standby holds every file again' });
    expect(await app.isUp(B), 'the primary runs throughout').to.equal(true);
    expect(app.twoRan, 'two holders ran the app').to.deep.equal([]);
  });

  it('rebuilds a standby whose volume is lost across a restart, and its copy syncs the primary\'s data again', async function () {
    this.timeout(900000);
    const appName = `e2elostrestart${stamp}`;
    const app = await placeApp(appName);
    const beforeLoss = client(A).getLastEventId();
    await crashFluxos(client(A).container, { hold: true });
    await destroyFolderVolume(client(A).container, `flux${appName}_${appName}`);
    await releaseFluxos(client(A).container);

    const decision = await client(A).waitForEvent('app:lostVolume', (d) => d.identifier === app.identifier, 180000, { afterId: beforeLoss });
    expect(decision.data.action, `the standby decided: ${JSON.stringify(decision.data)}`).to.equal('rebuild');
    await client(A).waitForEvent('app:componentRedeployed', (d) => d.name === appName && d.hard === true, 300000, { afterId: beforeLoss });
    await waitFor(() => holdsEveryFile(A, appName), { timeout: 300000, interval: 3000, label: 'the rebuilt standby holds every file again' });
    expect(await app.isUp(B), 'the primary runs throughout').to.equal(true);
    expect(app.becamePrimary(A, beforeLoss), 'the rebuilt standby became the primary').to.deep.equal([]);
    expect(app.twoRan, 'two holders ran the app').to.deep.equal([]);
  });

  it('removes the app from a primary whose volume is gone, and the standby takes it over with every file', async function () {
    this.timeout(1500000);
    const appName = `e2elostprimary${stamp}`;
    const app = await placeApp(appName);
    const beforeLoss = client(B).getLastEventId();
    const standbyMark = client(A).getLastEventId();
    let standbyLostFiles = false;
    const sampler = setInterval(() => {
      holdsEveryFile(A, appName).then((held) => { if (!held) standbyLostFiles = true; }).catch(() => {});
    }, 2000);
    try {
      await crashFluxos(client(B).container, { hold: true });
      await destroyFolderVolume(client(B).container, `flux${appName}_${appName}`);
      await releaseFluxos(client(B).container);

      const decision = await client(B).waitForEvent('app:lostVolume', (d) => d.identifier === app.identifier, 180000, { afterId: beforeLoss });
      expect(decision.data.action, `the primary decided: ${JSON.stringify(decision.data)}`).to.equal('remove');
      await waitForAppRemoved(client(B), appName, 180000, { afterId: beforeLoss });
      await assertNoEvent(client(B), 'app:componentRedeployed', (d) => d.name === appName, 1000, { afterId: beforeLoss });

      await clearMaster(appName);
      await waitFor(() => app.isUp(A), { timeout: 900000, interval: 5000, label: 'the standby runs the app' });
      expect(app.becamePrimary(A, standbyMark), 'the standby took the app over').to.not.be.empty;
      expect(await holdsEveryFile(A, appName), 'the standby runs the app with every file').to.equal(true);
    } finally {
      clearInterval(sampler);
    }
    expect(standbyLostFiles, 'the standby lost a file while the primary gave the app up').to.equal(false);
    expect(app.twoRan, 'two holders ran the app').to.deep.equal([]);
  });
});
