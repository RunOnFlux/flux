import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { isAppContainerRunning } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, getFolderStatus, getPendingFolders, getDeviceId, statPath,
} from '../framework/syncthing-real.js';
import { followPrimary } from '../framework/fdm-control.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A primary offers its folder to a new holder as soon as it lists the holder's
// device, which can be before the holder's own monitor has created the folder.
// A syncthing that accepted the offer would create the folder itself, with its
// default type, sendreceive - and the new holder's copy, wiped clean for the
// install, would go out as newer than the primary's data, which the primary would
// then delete. The offer must wait as pending until the holder creates the folder.
//
// The window is held open, not raced for: the new holder's monitor is paused at
// the checkpoint before it writes the folder, after it has written the
// primary's device, so the offer reaches a syncthing that knows the primary and
// holds no folder.

const BEFORE_FOLDER_WRITE = 'syncthing:beforeFolderWrite';

describe('a folder a peer offers before this node has created it', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eoffered${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const data = `/mnt/appdata/flux-apps/${folder}/appdata`;
  const PRIMARY = 0;
  const HOLDER = 1;
  let app;

  const client = (i) => env.clients[i];

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await followPrimary(appName, { nodes: [PRIMARY, HOLDER].map((i) => new URL(client(i).url).host), gNames: [folder] });
    await pushTestApp(appName, 'v1', 'offered', { user: 1000 });
    app = await buildSeedableApp({
      env,
      name: appName,
      instances: 2,
      compose: [{
        name: appName,
        description: 'offered before created',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: ['WRITE_FILE=/appdata/placed.txt', 'WRITE_CONTENT=placed'],
        commands: [],
        containerPorts: [80],
        containerData: 'g:/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });

    await installOnNodes(env, app, [PRIMARY]);
    await waitFor(() => isAppContainerRunning(client(PRIMARY).container, appName), {
      timeout: 300000, interval: 3000, label: 'the primary runs the app',
    });
    await waitFor(async () => (await getFolderStatus(client(PRIMARY), folder))?.localFiles > 0, {
      timeout: 120000, interval: 2000, label: 'the primary\'s syncthing holds the app\'s file',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('holds the offer as pending, creates no folder of its own, and leaves the primary\'s data in place', async function () {
    this.timeout(600000);
    const holder = client(HOLDER);
    const primaryDevice = await getDeviceId(client(PRIMARY));
    const from = holder.getLastEventId();
    await holder.holdCheckpoint(BEFORE_FOLDER_WRITE, folder);
    try {
      await installOnNodes(env, app, [HOLDER]);
      await holder.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_FOLDER_WRITE && d.key === folder, 300000, { afterId: from });

      // The primary lists the new holder and offers the folder. Whichever way the
      // holder's syncthing answers - pending, or a folder it created - the offer
      // has arrived, and the answer is read then.
      await waitFor(async () => Boolean((await getPendingFolders(holder))?.[folder]?.offeredBy?.[primaryDevice])
        || (await getFolderConfig(holder, folder)) !== null, {
        timeout: 240000, interval: 2000, label: 'the primary\'s offer of the folder reaches the new holder',
      });
      const created = await getFolderConfig(holder, folder);
      expect(created, `the new holder's syncthing created the folder itself: ${JSON.stringify(created && { type: created.type })}`).to.equal(null);
      expect(Object.keys((await getPendingFolders(holder))[folder].offeredBy), 'who offered the folder').to.include(primaryDevice);
    } finally {
      await holder.releaseCheckpoint(BEFORE_FOLDER_WRITE, folder);
    }

    // Released, the holder creates the folder, receiving, and takes the
    // primary's data; the primary's copy is untouched throughout.
    await waitFor(() => isFolderSynced(holder, folder), {
      timeout: 300000, interval: 3000, label: 'the new holder has the primary\'s data',
    });
    expect((await getFolderConfig(holder, folder)).type, 'the new holder\'s folder').to.equal('receiveonly');
    expect(await statPath(holder, `${data}/placed.txt`), 'the app\'s file on the new holder').to.not.equal(null);
    expect(await statPath(client(PRIMARY), `${data}/placed.txt`), 'the app\'s file on the primary').to.not.equal(null);
  });
});
