import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  execInContainer, isAppContainerRunning, blockPeerAccess, unblockPeerAccess,
  blockTraffic, unblockTraffic, crashFluxos, releaseFluxos,
} from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitForUp, waitForDown } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, getFolderStatus, getDeviceId, getDeviceStats, getConfigDevices,
  statPath, readPath, scanFolder, stopDaemon, startDaemon, getDaemonEvents, lastDaemonEventId,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Who writes a single-writer (g:) app's data, decided on real syncthing daemons.
//
// Three holders are placed in order, so the election ranks them in that order:
// the first runs the component and is the only copy that sends, the others hold
// receiveonly copies. Each test moves the app through one of the moments that
// decide the writer, and every test holds the same invariant: at most one node
// runs the component.
//
// The third holder is placed while its syncthing cannot exchange traffic with
// the primary's, so it learns the primary's device and never connects to it;
// then the primary's API goes silent to it, as while the primary's FluxOS
// restarts. That its syncthing has never been connected is the real daemon's
// own record, not a declared one.

const APP_UID = 1000;
const API_PORT = 16127;
const SYNCTHING_PORT = API_PORT + 2;

describe('single-writer election on real syncthing', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eswelect${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const folder = `flux${identifier}`;
  const root = `/mnt/appdata/flux-apps/${folder}`;
  // Placed in this order; a fourth node holds nothing and keeps the ring whole
  // while one link is cut.
  const FIRST = 0;
  const SECOND = 1;
  const LATE = 2;
  const HOLDERS = [FIRST, SECOND, LATE];
  let app;

  const client = (i) => env.clients[i];
  const runners = async () => {
    const running = await Promise.all(HOLDERS.map((i) => isAppContainerRunning(client(i).container, appName)));
    return HOLDERS.filter((_, k) => running[k]);
  };
  // Asserted on every poll of every wait below, not only at the end.
  const oneWriterAtMost = async () => {
    const running = await runners();
    expect(running.length, `more than one node runs the component: ${running.join(', ')}`).to.be.at.most(1);
    return running;
  };
  // How this node's election has judged a silent peer ahead of it, pass by pass:
  // 'noEvidence' is a silence it may not act on, 'gone' one it may.
  const silenceVerdicts = (i, verdict) => client(i).getDecisionCount('peer:silenceVerdict', identifier, verdict);
  const ownerAuth = async (i) => (await authenticate(client(i).url, appOwnerKey())).zelidauth;

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
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

    await pushTestApp(appName, 'v1', 'swelect', { user: APP_UID });
    app = await buildSeedableApp({
      env,
      name: appName,
      instances: HOLDERS.length,
      compose: [{
        name: appName,
        description: 'single-writer election',
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

    // Placed one at a time: a node learns of the app only when it is installed,
    // so no spawner can place it out of order.
    await installOnNodes(env, app, [FIRST]);
    await waitForUp(client(FIRST), appName, 'the first holder runs the app', { timeout: 300000, interval: 3000 });
    await installOnNodes(env, app, [SECOND]);
    await waitFor(() => isFolderSynced(client(SECOND), folder), {
      timeout: 300000, interval: 3000, label: 'the second holder has the primary\'s data',
    });

    // The late holder's syncthing never reaches the primary's. It still learns
    // the primary's device through the primary's API, and only then does that
    // API go silent to it.
    await blockTraffic(client(LATE).container, [client(FIRST).ip], SYNCTHING_PORT);
    await installOnNodes(env, app, [LATE]);
    await waitFor(() => isFolderSynced(client(LATE), folder), {
      timeout: 300000, interval: 3000, label: 'the late holder has the data, from the second holder',
    });
    const primaryDevice = await getDeviceId(client(FIRST));
    await waitFor(async () => (await getConfigDevices(client(LATE))).some((d) => d.deviceID === primaryDevice), {
      timeout: 120000, interval: 2000, label: 'the late holder has configured the primary\'s device',
    });
    await blockPeerAccess(client(FIRST).container, [client(LATE).ip], API_PORT);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('does not read a primary\'s silence as its death when syncthing has never been connected to it', async function () {
    this.timeout(420000);
    const primaryDevice = await getDeviceId(client(FIRST));
    const seen = (await getDeviceStats(client(LATE)))[primaryDevice]?.lastSeen;
    expect(seen, 'fixture: the late holder\'s syncthing does not know the primary\'s device').to.be.a('string');
    expect(Date.parse(seen), `fixture: the late holder's syncthing has met the primary (lastSeen ${seen})`).to.equal(0);
    expect(await runners(), 'fixture: the first holder is the primary').to.deep.equal([FIRST]);

    // Every one of these is a pass in which the late holder reached the primary
    // in the election order and found it silent. The primary is the only peer
    // silent to it, so each is a verdict on the primary.
    const gone = await silenceVerdicts(LATE, 'gone');
    const from = await silenceVerdicts(LATE, 'noEvidence');
    await waitFor(async () => {
      await oneWriterAtMost();
      return await silenceVerdicts(LATE, 'noEvidence') >= from + 3;
    }, { timeout: 300000, interval: 3000, label: 'three election passes on the late holder that found no evidence of the primary\'s death' });
    expect(await silenceVerdicts(LATE, 'gone') - gone, 'passes that read the silence as death').to.equal(0);

    expect(await runners(), 'the writer after those passes').to.deep.equal([FIRST]);
    expect((await getFolderConfig(client(LATE), folder)).type, 'the late holder\'s folder').to.equal('receiveonly');
  });

  it('replaces a primary that dies with the standby that was connected to it', async function () {
    this.timeout(420000);
    // The whole machine: the process, the container and the daemon.
    await crashFluxos(client(FIRST).container, { hold: true });
    await execInContainer(client(FIRST).container, `docker kill flux${appName}_${appName}`);
    await stopDaemon(client(FIRST));

    await waitFor(async () => (await oneWriterAtMost()).includes(SECOND), {
      timeout: 300000, interval: 3000, label: 'the second holder takes over',
    });
    await waitFor(async () => (await getFolderConfig(client(SECOND), folder))?.type === 'sendreceive', {
      timeout: 120000, interval: 2000, label: 'the new primary\'s folder sends',
    });
    expect((await getFolderConfig(client(LATE), folder)).type, 'the late holder\'s folder').to.equal('receiveonly');
  });

  it('brings the old primary back as a standby, scanning its copy before it stops sending', async function () {
    this.timeout(420000);
    await unblockPeerAccess(client(FIRST).container, [client(LATE).ip], API_PORT);
    await unblockTraffic(client(LATE).container, [client(FIRST).ip], SYNCTHING_PORT);

    // The daemon comes back first and scans every folder, as on a boot. The mark
    // is taken once that is over, so a scan after it is FluxOS's.
    await startDaemon(client(FIRST));
    await waitFor(async () => (await getFolderStatus(client(FIRST), folder)).state === 'idle', {
      timeout: 120000, interval: 1000, label: 'the old primary\'s daemon finished its start-up scan',
    });
    expect((await getFolderConfig(client(FIRST), folder)).type, 'fixture: the old primary still sends').to.equal('sendreceive');
    const mark = await lastDaemonEventId(client(FIRST));

    await releaseFluxos(client(FIRST).container);
    await waitFor(async () => {
      await oneWriterAtMost();
      return (await getFolderConfig(client(FIRST), folder))?.type === 'receiveonly';
    }, { timeout: 300000, interval: 2000, label: 'the old primary stops sending' });

    const events = await getDaemonEvents(client(FIRST), { since: mark, events: ['StateChanged', 'ConfigSaved'] });
    const demoted = events.find((e) => e.type === 'ConfigSaved'
      && (e.data?.folders || []).some((f) => f.id === folder && f.type === 'receiveonly'));
    expect(demoted, 'the demotion in the daemon\'s event log').to.not.equal(undefined);
    const scanned = events.find((e) => e.type === 'StateChanged' && e.data?.folder === folder
      && e.data?.to === 'scanning' && e.id < demoted.id);
    expect(scanned, 'the folder was scanned before it stopped sending').to.not.equal(undefined);

    expect(await runners(), 'the writer').to.deep.equal([SECOND]);
  });

  it('keeps a primary its owner stopped sending, and carries the owner\'s edits to every standby', async function () {
    this.timeout(420000);
    const stopped = await client(SECOND).getAuthed(`/apps/appstop/${appName}`, await ownerAuth(SECOND));
    expect(stopped.status, JSON.stringify(stopped)).to.equal('success');
    await waitForDown(client(SECOND), appName, 'the owner stopped the primary', { timeout: 120000 });

    // Held over several election and monitor passes: nobody takes over a copy
    // its owner is working on, and it does not stop sending.
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      expect(await oneWriterAtMost(), 'a node started while the owner had the primary stopped').to.deep.equal([]);
      // eslint-disable-next-line no-await-in-loop
      expect((await getFolderConfig(client(SECOND), folder)).type, 'the stopped primary\'s folder').to.equal('sendreceive');
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(3000);
    }

    // The owner's edit, made as the app's own user.
    const edit = `${root}/appdata/edited-while-stopped.txt`;
    const wrote = await execInContainer(client(SECOND).container,
      `printf 'edited while stopped' > ${edit} && chown ${APP_UID}:${APP_UID} ${edit}`);
    expect(wrote.exitCode, `fixture: ${wrote.output}`).to.equal(0);
    await scanFolder(client(SECOND), folder);
    for (const i of [FIRST, LATE]) {
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => (await readPath(client(i), edit)) === 'edited while stopped', {
        timeout: 240000, interval: 3000, label: `the edit reached node ${i}`,
      });
      // eslint-disable-next-line no-await-in-loop
      expect(await statPath(client(i), edit), `owner of the edit on node ${i}`).to.include({ uid: APP_UID, gid: APP_UID });
    }

    const started = await client(SECOND).getAuthed(`/apps/appstart/${appName}`, await ownerAuth(SECOND));
    expect(started.status, JSON.stringify(started)).to.equal('success');
    await waitFor(async () => (await oneWriterAtMost()).length === 1, {
      timeout: 300000, interval: 3000, label: 'one node runs the app again',
    });
  });
});
