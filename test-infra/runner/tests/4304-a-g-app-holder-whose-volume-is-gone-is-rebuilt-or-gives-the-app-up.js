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
 * disk holding it, rebooted. A component is rebuilt at most once an hour, and a
 * restart forgets that, so the standby's restart comes after its first rebuild.
 *
 * A = the standby, B = the primary, C holds nothing.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { placeSilentPrimaryApp, A, B } from '../framework/silent-primary.js';
import { execInContainer, crashFluxos, releaseFluxos } from '../framework/container.js';
import { clearMaster } from '../framework/fdm-control.js';
import { scanFolder, listFolderFiles } from '../framework/syncthing-real.js';
import { destroyFolderVolume } from '../framework/volume-fixture.js';
import { waitFor, waitForAppRemoved, assertNoEvent } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const SIGTERM_EXPIRY_S = 120;
const FILES = ['one', 'two', 'three'];

describe('a g: app holder whose volume is gone is rebuilt, or gives the app up', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2elostvol${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const appdata = `/mnt/appdata/flux-apps/${folder}/appdata`;
  const client = (i) => fleet.env.clients[i];
  const filesOn = async (i) => (await listFolderFiles(client(i), appdata)).split(' ').filter(Boolean);
  const holdsEveryFile = async (i) => {
    const held = await filesOn(i);
    return ['seed-data', ...FILES].every((name) => held.includes(name));
  };

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
    const wrote = await execInContainer(client(B).container, FILES.map((name) => `printf '${name}' > ${appdata}/${name}`).join(' && '));
    expect(wrote.exitCode, `fixture: ${wrote.output}`).to.equal(0);
    await scanFolder(client(B), folder);
    await waitFor(() => holdsEveryFile(A), { timeout: 240000, interval: 3000, label: 'the standby holds every file the primary wrote' });
  });

  after(async function () {
    this.timeout(60000);
    fleet?.stop();
    await fleet?.env?.teardown();
  });

  it('rebuilds a standby whose volume is unmounted under a running FluxOS, as it goes', async function () {
    this.timeout(600000);
    const beforeLoss = client(A).getLastEventId();
    await destroyFolderVolume(client(A).container, folder);

    // Within a minute: the hourly sweep is not what finds it.
    const decision = await client(A).waitForEvent('app:lostVolume', (d) => d.identifier === fleet.identifier, 60000, { afterId: beforeLoss });
    expect(decision.data.action, `the standby decided: ${JSON.stringify(decision.data)}`).to.equal('rebuild');
    await client(A).waitForEvent('app:componentRedeployed', (d) => d.name === appName && d.hard === true, 300000, { afterId: beforeLoss });
    await waitFor(() => holdsEveryFile(A), { timeout: 300000, interval: 3000, label: 'the rebuilt standby holds every file again' });
    expect(await fleet.isUp(B), 'the primary runs throughout').to.equal(true);
    expect(fleet.twoRan, 'two holders ran the app').to.deep.equal([]);
  });

  it('rebuilds a standby whose volume is lost across a restart, and its copy syncs the primary\'s data again', async function () {
    this.timeout(600000);
    const beforeLoss = client(A).getLastEventId();
    await crashFluxos(client(A).container, { hold: true });
    await destroyFolderVolume(client(A).container, folder);
    await releaseFluxos(client(A).container);

    const decision = await client(A).waitForEvent('app:lostVolume', (d) => d.identifier === fleet.identifier, 180000, { afterId: beforeLoss });
    expect(decision.data.action, `the standby decided: ${JSON.stringify(decision.data)}`).to.equal('rebuild');
    await client(A).waitForEvent('app:componentRedeployed', (d) => d.name === appName && d.hard === true, 300000, { afterId: beforeLoss });
    await waitFor(() => holdsEveryFile(A), { timeout: 300000, interval: 3000, label: 'the rebuilt standby holds every file again' });
    expect(await fleet.isUp(B), 'the primary runs throughout').to.equal(true);
    expect(fleet.becamePrimary(A, beforeLoss), 'the rebuilt standby became the primary').to.deep.equal([]);
    expect(fleet.twoRan, 'two holders ran the app').to.deep.equal([]);
  });

  it('removes the app from a primary whose volume is gone, and the standby takes it over with every file', async function () {
    this.timeout(1200000);
    const beforeLoss = client(B).getLastEventId();
    const standbyMark = client(A).getLastEventId();
    let standbyLostFiles = false;
    const sampler = setInterval(() => {
      holdsEveryFile(A).then((held) => { if (!held) standbyLostFiles = true; }).catch(() => {});
    }, 2000);
    try {
      await crashFluxos(client(B).container, { hold: true });
      await destroyFolderVolume(client(B).container, folder);
      await releaseFluxos(client(B).container);

      const decision = await client(B).waitForEvent('app:lostVolume', (d) => d.identifier === fleet.identifier, 180000, { afterId: beforeLoss });
      expect(decision.data.action, `the primary decided: ${JSON.stringify(decision.data)}`).to.equal('remove');
      await waitForAppRemoved(client(B), appName, 180000, { afterId: beforeLoss });
      await assertNoEvent(client(B), 'app:componentRedeployed', (d) => d.name === appName, 1000, { afterId: beforeLoss });

      await clearMaster(appName);
      await waitFor(() => fleet.isUp(A), { timeout: 900000, interval: 5000, label: 'the standby runs the app' });
      expect(fleet.becamePrimary(A, standbyMark), 'the standby took the app over').to.not.be.empty;
      expect(await holdsEveryFile(A), 'the standby runs the app with every file').to.equal(true);
    } finally {
      clearInterval(sampler);
    }
    expect(standbyLostFiles, 'the standby lost a file while the primary gave the app up').to.equal(false);
    expect(fleet.twoRan, 'two holders ran the app').to.deep.equal([]);
  });
});
