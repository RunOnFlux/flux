import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, isAppContainerRunning } from '../framework/container.js';
import { pushTestApp, mirrorExecutorImage, executorImageReference } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import {
  isDaemonUp, getFolderConfig, getFolderStatus, scanFolder, statPath, readPath,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A single-writer (g:) app's copies, carried by real syncthing daemons.
//
// One node runs the component and writes; the others hold synced copies with
// the component stopped, ready to take over. What makes a copy usable when it
// does is that it is the primary's data exactly - its content, and also its
// owners and modes, because the same image runs as the same user on whichever
// node holds it. The control-plane stub moves no files, so none of that can be
// shown against it; here every node runs its own daemon, FluxOS configures it,
// and the assertions read the disk.
//
// The app runs as uid 1000 and writes one file with mode 0755 when it starts,
// so the primary's copy holds data only its own user wrote.

const APP_UID = 1000;
const WRITTEN = 'written-by-app.bin';
const WRITTEN_CONTENT = 'hello from the app';

describe('single-writer copies on real syncthing', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eswcopy${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const root = `/mnt/appdata/flux-apps/${folder}`;
  const HOLDERS = [0, 1];
  let primary;
  let standby;
  let auth;

  const uploadTo = (client, relativeFolder, files) => client.upload(
    `/ioutils/fileupload/volume/${appName}/${appName}/${encodeURIComponent(relativeFolder)}`,
    files,
    { zelidauth: auth.zelidauth },
  );

  // The upload endpoint answers 200 whatever happened and writes a failure
  // envelope into its streamed body.
  const failureIn = (body) => {
    const marker = body.indexOf('"status":"error"');
    if (marker < 0) return null;
    const opened = body.lastIndexOf('{', marker);
    let depth = 0;
    for (let i = opened; i < body.length; i += 1) {
      if (body[i] === '{') depth += 1;
      if (body[i] === '}') {
        depth -= 1;
        if (depth === 0) return JSON.parse(body.slice(opened, i + 1));
      }
    }
    return null;
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          volumeOperations: { image: executorImageReference() },
        },
      },
    });
    await mirrorExecutorImage();
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await pushTestApp(appName, 'v1', 'swcopy', { user: APP_UID });
    const app = await buildSeedableApp({
      env,
      name: appName,
      instances: HOLDERS.length,
      compose: [{
        name: appName,
        description: 'single-writer copy',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [
          `WRITE_FILE=/appdata/${WRITTEN}`,
          'WRITE_MODE=0755',
          `WRITE_CONTENT=${WRITTEN_CONTENT}`,
        ],
        commands: [],
        containerPorts: [80],
        containerData: 'g:/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });

    // One holder first, so it is the only candidate and seeds the folder; the
    // second is placed once the first is writing, and follows it.
    [primary, standby] = HOLDERS.map((i) => env.clients[i]);
    await installOnNodes(env, app, [HOLDERS[0]]);
    await waitForUp(primary, appName, 'the first holder runs the app', { timeout: 300000, interval: 3000 });
    await waitFor(async () => (await readPath(primary, `${root}/appdata/${WRITTEN}`)) === WRITTEN_CONTENT, {
      timeout: 120000, interval: 2000, label: 'the app wrote its file on the primary',
    });
    await installOnNodes(env, app, [HOLDERS[1]]);

    auth = await authenticate(primary.url, appOwnerKey());
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('configures every copy to carry owners and never to keep conflict copies', async function () {
    this.timeout(180000);
    for (const client of [primary, standby]) {
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => (await getFolderConfig(client, folder)) !== null, {
        timeout: 120000, interval: 2000, label: `folder configured on node ${client.num}`,
      });
      // eslint-disable-next-line no-await-in-loop
      const config = await getFolderConfig(client, folder);
      expect(config.syncOwnership, `syncOwnership on node ${client.num}`).to.equal(true);
      expect(config.maxConflicts, `maxConflicts on node ${client.num}`).to.equal(0);
    }
  });

  it('sends only from the primary: the standby receives, and runs nothing', async function () {
    this.timeout(180000);
    await waitFor(async () => (await getFolderConfig(standby, folder))?.type === 'receiveonly', {
      timeout: 120000, interval: 2000, label: 'the standby folder is receiveonly',
    });
    expect((await getFolderConfig(primary, folder)).type, 'the primary folder').to.equal('sendreceive');

    // Held over several monitor and election passes, not read once.
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      expect(await isAppContainerRunning(standby.container, appName), 'the standby ran the component').to.equal(false);
      // eslint-disable-next-line no-await-in-loop
      expect((await getFolderConfig(standby, folder)).type, 'the standby folder').to.equal('receiveonly');
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(3000);
    }
  });

  it('delivers what the app wrote to the standby with the app\'s own owner and mode', async function () {
    this.timeout(300000);
    const path = `${root}/appdata/${WRITTEN}`;
    await waitFor(async () => (await readPath(standby, path)) === WRITTEN_CONTENT, {
      timeout: 240000, interval: 3000, label: 'the app\'s file reached the standby',
    });
    const onPrimary = await statPath(primary, path);
    expect(onPrimary, 'fixture: the app wrote as its own user').to.deep.equal({ uid: APP_UID, gid: 0, mode: '755' });
    expect(await statPath(standby, path), 'owner and mode on the standby').to.deep.equal(onPrimary);
  });

  it('puts the standby back to the primary\'s copy: content, owner, strays - and leaves ignored paths', async function () {
    this.timeout(300000);
    const written = `${root}/appdata/${WRITTEN}`;
    const stray = `${root}/appdata/stray.txt`;
    const kept = `${root}/backup/kept.txt`;
    const mark = standby.getLastEventId();
    const changed = await execInContainer(standby.container,
      `printf 'changed on the standby' > ${written} && chown 0:0 ${written} && chmod 644 ${written} `
      + `&& printf 'stray' > ${stray} && mkdir -p ${root}/backup && printf 'kept' > ${kept}`);
    expect(changed.exitCode, `fixture: ${changed.output}`).to.equal(0);
    // Noticed now rather than at the watcher's delay.
    await scanFolder(standby, folder);
    // Waited on as the revert itself: the folder's count of changed files lasts
    // only until that revert, which can come before a poll of the count.
    await standby.waitForEvent('syncthing:localChangesReverted', (data) => data.folder === folder && data.files >= 2, 120000, { afterId: mark });

    await waitFor(async () => (await readPath(standby, written)) === WRITTEN_CONTENT
      && (await readPath(standby, stray)) === null, {
      timeout: 240000, interval: 3000, label: 'the standby reverted its changes',
    });
    expect(await statPath(standby, written), 'owner and mode put back').to.deep.equal({ uid: APP_UID, gid: 0, mode: '755' });
    expect(await readPath(standby, kept), 'an ignored path is left alone').to.equal('kept');
    const status = await getFolderStatus(standby, folder);
    expect(status.receiveOnlyChangedFiles, 'files still changed').to.equal(0);
    expect(status.receiveOnlyChangedDirectories ?? 0, 'directories still changed').to.equal(0);
    expect(await readPath(primary, stray), 'the stray reached the primary').to.equal(null);
  });

  it('refuses a file-browser write on the standby and writes nothing', async function () {
    this.timeout(120000);
    const { body } = await uploadTo(standby, 'appdata', { 'refused.txt': 'should not land' });
    const failure = failureIn(body);
    expect(failure, `the standby accepted the upload: ${body.slice(-300)}`).to.not.equal(null);
    expect(failure.data?.name, JSON.stringify(failure)).to.equal('ReadOnlyCopy');
    expect(await readPath(standby, `${root}/appdata/refused.txt`), 'written on the standby').to.equal(null);
    expect(await readPath(primary, `${root}/appdata/refused.txt`), 'written on the primary').to.equal(null);
  });

  it('gives a file uploaded on the primary the owner of its folder, and carries that owner to the standby', async function () {
    this.timeout(300000);
    // A folder the app's own user made, as an app makes its save directory.
    const made = await execInContainer(primary.container,
      `mkdir -p ${root}/appdata/saves && chown ${APP_UID}:${APP_UID} ${root}/appdata/saves`);
    expect(made.exitCode, `fixture: ${made.output}`).to.equal(0);

    const { body } = await uploadTo(primary, 'appdata/saves', { 'uploaded.txt': 'uploaded by the owner' });
    expect(failureIn(body), `the upload failed: ${body.slice(-300)}`).to.equal(null);

    const path = `${root}/appdata/saves/uploaded.txt`;
    expect(await statPath(primary, path), 'owner on the primary').to.include({ uid: APP_UID, gid: APP_UID });
    await waitFor(async () => (await readPath(standby, path)) === 'uploaded by the owner', {
      timeout: 240000, interval: 3000, label: 'the upload reached the standby',
    });
    expect(await statPath(standby, path), 'owner on the standby').to.include({ uid: APP_UID, gid: APP_UID });
  });
});
