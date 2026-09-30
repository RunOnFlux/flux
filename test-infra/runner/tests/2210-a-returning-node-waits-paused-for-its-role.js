import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  execInContainer, isAppContainerRunning, crashFluxos, releaseFluxos, shutdownFluxosGracefully,
} from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, getConfigDevices, getDeviceId, readPath, scanFolder,
  stopDaemon, startDaemon, getDaemonEvents, syncthingCommandLines, holdsValidVersion,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// fleet: 3
//
// A node's syncthing comes back paused - from a planned shutdown that paused
// every folder, from --paused on its start (FluxOS's launch on a legacy node,
// the OS unit on Arcane) - and nothing it holds moves until FluxOS has decided
// what each folder is. A single-writer (g:) app on two holders, one Arcane and
// one legacy; a third node holds nothing, so each node has the peers the network
// policy needs.
//
//   - A syncthing started paused has its devices resumed, and each folder
//     unpaused with the role it has.
//   - A restart of FluxOS alone pauses nothing.
//   - A planned shutdown pauses every folder. The node returns, another holder
//     has taken over, and what it wrote while down is discarded, unsent.
//   - A primary returning while the other holder cannot be judged stays paused.
//     Once no other holder runs the component, what it wrote goes out.
//
// Throughout, at most one node runs the component.

const APP_UID = 1000;

describe('a returning node waits paused until its role is decided', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eswpaused${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const folder = `flux${identifier}`;
  const data = `/mnt/appdata/flux-apps/${folder}/appdata`;
  const ARCANE = 0;
  const LEGACY = 1;
  const HOLDERS = [ARCANE, LEGACY];

  const client = (i) => env.clients[i];
  const sh = async (i, command) => execInContainer(client(i).container, command);
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
  const folderIs = async (i, fields) => {
    const config = await getFolderConfig(client(i), folder).catch(() => null);
    return !!config && Object.entries(fields).every(([key, value]) => config[key] === value);
  };
  // A file the app's own user wrote into the node's copy, announced if the
  // folder can send.
  const writeAsApp = async (i, name, content) => {
    const r = await sh(i, `printf '${content}' > ${data}/${name} && chown ${APP_UID}:${APP_UID} ${data}/${name}`);
    expect(r.exitCode, `fixture: ${r.output}`).to.equal(0);
  };
  const reachesNode = (i, name, content, label) => waitFor(async () => {
    await oneWriterAtMost();
    return (await readPath(client(i), `${data}/${name}`)) === content;
  }, { timeout: 240000, interval: 3000, label });
  const heldPausedPasses = (i) => client(i).getDecisionCount('primaryRole:returned', identifier, 'heldPaused');
  // The peer devices a node's syncthing holds paused. --paused pauses the node's
  // own device too, which connects to nothing.
  const pausedPeerDevices = async (i) => {
    const own = await getDeviceId(client(i));
    return (await getConfigDevices(client(i))).filter((d) => d.paused && d.deviceID !== own).map((d) => d.deviceID);
  };
  // A folder id syncthing names in a ConfigSaved event, with its type and pause.
  const savedFolder = (event) => (event.data?.folders || []).find((f) => f.id === folder);

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      legacyNodes: [LEGACY],
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

    await pushTestApp(appName, 'v1', 'swpaused', { user: APP_UID });
    const app = await buildSeedableApp({
      env,
      name: appName,
      instances: HOLDERS.length,
      compose: [{
        name: appName,
        description: 'returning node waits paused',
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

    // Placed one at a time, so the election ranks the Arcane node first.
    await installOnNodes(env, app, [ARCANE]);
    await waitForUp(client(ARCANE), appName, 'the Arcane node runs the app', { timeout: 300000, interval: 3000 });
    await installOnNodes(env, app, [LEGACY]);
    await waitFor(() => isFolderSynced(client(LEGACY), folder), {
      timeout: 300000, interval: 3000, label: 'the legacy standby has the primary\'s data',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('starts a legacy node\'s syncthing paused, and unpauses its folder with its role', async function () {
    this.timeout(120000);
    const commandLines = await syncthingCommandLines(client(LEGACY));
    expect(commandLines, 'fixture: no syncthing on the legacy node').to.not.have.lengthOf(0);
    commandLines.forEach((line) => expect(line, 'the legacy syncthing FluxOS started').to.include('--paused'));

    expect(await folderIs(LEGACY, { type: 'receiveonly', paused: false }), 'the standby\'s folder').to.equal(true);
    expect(await pausedPeerDevices(LEGACY), 'peer devices left paused').to.deep.equal([]);
  });

  it('pauses nothing when FluxOS alone restarts', async function () {
    this.timeout(300000);
    const [{ id: since }] = (await getDaemonEvents(client(ARCANE))).slice(-1);
    const pid = (await sh(ARCANE, 'cat /tmp/fluxos.pid')).stdout.trim();
    expect(pid, 'fixture: no FluxOS pid').to.match(/^\d+$/);

    // SIGTERM with no system shutdown under way: the service restarting.
    await sh(ARCANE, `kill -TERM ${pid}`);
    await waitFor(async () => (await sh(ARCANE, `kill -0 ${pid} 2>/dev/null`)).exitCode !== 0, {
      timeout: 60000, interval: 500, label: 'the FluxOS that was signalled exits',
    });
    await waitFor(async () => (await sh(ARCANE, 'curl -sf -o /dev/null http://127.0.0.1:16127/flux/version')).exitCode === 0, {
      timeout: 120000, interval: 1000, label: 'FluxOS answers again',
    });

    const paused = (await getDaemonEvents(client(ARCANE), { since, events: ['ConfigSaved'] }))
      .filter((event) => savedFolder(event)?.paused);
    expect(paused, 'a config write that paused the folder').to.deep.equal([]);
    expect(await folderIs(ARCANE, { type: 'sendreceive', paused: false }), 'the primary\'s folder').to.equal(true);
    expect(await oneWriterAtMost(), 'the writer').to.deep.equal([ARCANE]);
  });

  it('brings a legacy standby\'s crashed syncthing back paused, and receiving again', async function () {
    this.timeout(300000);
    const mark = client(LEGACY).getLastEventId();
    await stopDaemon(client(LEGACY));

    await waitFor(async () => (await syncthingCommandLines(client(LEGACY))).length > 0 && await isDaemonUp(client(LEGACY)), {
      timeout: 180000, interval: 2000, label: 'FluxOS starts the legacy node\'s syncthing again',
    });
    (await syncthingCommandLines(client(LEGACY))).forEach((line) => expect(line).to.include('--paused'));
    await client(LEGACY).waitForEvent('syncthing:devicesResumed', () => true, 120000, { afterId: mark });
    await waitFor(async () => {
      await oneWriterAtMost();
      return folderIs(LEGACY, { type: 'receiveonly', paused: false });
    }, { timeout: 120000, interval: 2000, label: 'the standby\'s folder receives again' });

    await writeAsApp(ARCANE, 'after-legacy-restart.txt', 'written on the primary');
    await scanFolder(client(ARCANE), folder);
    await reachesNode(LEGACY, 'after-legacy-restart.txt', 'written on the primary', 'the primary\'s write reaches the standby');
  });

  it('keeps the primary sending through its own syncthing restarting paused, as the ISO unit starts it', async function () {
    this.timeout(300000);
    const mark = client(ARCANE).getLastEventId();
    await stopDaemon(client(ARCANE));
    await startDaemon(client(ARCANE), { paused: true });
    expect(await folderIs(ARCANE, { paused: true }), 'fixture: the folder came back paused').to.equal(true);

    await client(ARCANE).waitForEvent('syncthing:devicesResumed', () => true, 120000, { afterId: mark });
    await waitFor(async () => {
      expect(await oneWriterAtMost(), 'the writer while its syncthing restarts').to.deep.equal([ARCANE]);
      return folderIs(ARCANE, { type: 'sendreceive', paused: false });
    }, { timeout: 120000, interval: 2000, label: 'the primary\'s folder sends again' });

    await writeAsApp(ARCANE, 'after-arcane-restart.txt', 'written after the restart');
    await scanFolder(client(ARCANE), folder);
    await reachesNode(LEGACY, 'after-arcane-restart.txt', 'written after the restart', 'the primary\'s write reaches the standby');
  });

  it('pauses every folder on a planned shutdown, and discards what the node wrote while away once another holder runs it', async function () {
    this.timeout(900000);
    const mark = client(ARCANE).getLastEventId();
    // The syncthing the next boot starts has no --paused, as on the fleet before
    // the ISO carries it: the pause the shutdown left is all that holds it.
    await shutdownFluxosGracefully(client(ARCANE).container, { hold: true, stopSyncthingAfter: true });
    const paused = await client(ARCANE).waitForEvent('shutdown:paused', () => true, 10000, { afterId: mark });
    expect(paused.data.paused, 'the folders the shutdown paused').to.include(folder);

    await waitFor(async () => (await oneWriterAtMost()).includes(LEGACY), {
      timeout: 600000, interval: 3000, label: 'the legacy standby takes over',
    });

    // Written on the node that left, after it left: nothing peers have.
    await writeAsApp(ARCANE, 'written-while-away.txt', 'never sent');
    await startDaemon(client(ARCANE), { paused: false });
    expect(await folderIs(ARCANE, { type: 'sendreceive', paused: true }), 'fixture: the folder the shutdown paused').to.equal(true);
    expect(await pausedPeerDevices(ARCANE), 'fixture: peer devices paused on a start without --paused').to.deep.equal([]);

    const returned = client(ARCANE).getLastEventId();
    await releaseFluxos(client(ARCANE).container);
    const decision = await client(ARCANE).waitForEvent('primaryRole:returned', () => true, 300000, { afterId: returned });
    expect(decision.data, 'what the returning node decided').to.deep.equal({ identifier, outcome: 'discarded' });

    // Every config the returned node's daemon held since it started: never one
    // in which the folder sent unpaused.
    const sentUnpaused = (await getDaemonEvents(client(ARCANE), { events: ['ConfigSaved'] }))
      .filter((e) => savedFolder(e)?.type === 'sendreceive' && !savedFolder(e).paused);
    expect(sentUnpaused, 'a config in which the returned node\'s folder sent').to.deep.equal([]);

    await waitFor(async () => {
      await oneWriterAtMost();
      return await folderIs(ARCANE, { type: 'receiveonly', paused: false })
        && await isFolderSynced(client(ARCANE), folder)
        && (await readPath(client(ARCANE), `${data}/written-while-away.txt`)) === null;
    }, { timeout: 300000, interval: 3000, label: 'the returned node is a synced standby and its unsent write is gone' });
    expect(await readPath(client(LEGACY), `${data}/written-while-away.txt`), 'the unsent write on the new primary').to.equal(null);
    expect(await holdsValidVersion(client(LEGACY), folder, 'appdata/written-while-away.txt'), 'a version of the unsent write on the new primary').to.equal(false);
    expect(await runners(), 'the writer').to.deep.equal([LEGACY]);
  });

  describe('a primary returning while the other holder cannot be judged', () => {
    // The Arcane standby's docker socket, moved aside: its FluxOS answers what it
    // holds with an error, and its own election cannot run to take over.
    const hideDocker = () => sh(ARCANE, 'mv /var/run/docker.sock /var/run/docker.sock.held');
    const restoreDocker = () => sh(ARCANE, 'test -e /var/run/docker.sock.held && mv /var/run/docker.sock.held /var/run/docker.sock; true');

    after(async () => {
      await restoreDocker();
    });

    it('stays paused, and sends nothing, while the other holder cannot be ruled out', async function () {
      this.timeout(600000);
      const hidden = await hideDocker();
      expect(hidden.exitCode, `fixture: ${hidden.output}`).to.equal(0);

      // The whole machine: the process, the container and the daemon.
      await crashFluxos(client(LEGACY).container, { hold: true });
      await execInContainer(client(LEGACY).container, `docker kill flux${identifier}`);
      await stopDaemon(client(LEGACY));
      await writeAsApp(LEGACY, 'written-while-down.txt', 'sent once it is safe');

      const returned = client(LEGACY).getLastEventId();
      // The counters start again with the FluxOS that returns.
      await releaseFluxos(client(LEGACY).container);
      await waitFor(async () => {
        await oneWriterAtMost();
        expect(await readPath(client(ARCANE), `${data}/written-while-down.txt`), 'the write left while the folder waited').to.equal(null);
        return await heldPausedPasses(LEGACY) >= 3;
      }, { timeout: 300000, interval: 3000, label: 'three passes that kept the returned primary paused' });

      expect(await folderIs(LEGACY, { type: 'sendreceive', paused: true }), 'the returned primary\'s folder').to.equal(true);
      const decided = client(LEGACY).getEventBuffer().filter((e) => e.event === 'primaryRole:returned' && e.id > returned);
      expect(decided, 'a decision made while the holder could not be ruled out').to.deep.equal([]);
    });

    it('sends what it wrote while down once no other holder runs the component', async function () {
      this.timeout(600000);
      const mark = client(LEGACY).getLastEventId();
      const restored = await restoreDocker();
      expect(restored.exitCode, `fixture: ${restored.output}`).to.equal(0);

      const decision = await client(LEGACY).waitForEvent('primaryRole:returned', () => true, 300000, { afterId: mark });
      expect(decision.data, 'what the returning node decided').to.deep.equal({ identifier, outcome: 'kept' });
      await reachesNode(ARCANE, 'written-while-down.txt', 'sent once it is safe', 'the write reaches the other holder');

      await waitFor(async () => (await oneWriterAtMost()).length === 1, {
        timeout: 600000, interval: 3000, label: 'one node runs the app again',
      });
      const [writer] = await runners();
      expect(await readPath(client(writer), `${data}/written-while-down.txt`), 'the write on the node that runs the app').to.equal('sent once it is safe');
    });
  });
});
