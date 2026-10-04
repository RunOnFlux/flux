import {
  describe, it, before, after, beforeEach, afterEach,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  execInContainer, isAppContainerRunning, crashFluxos, releaseFluxos, shutdownFluxosGracefully,
  redirectOutbound, clearOutboundRedirect,
} from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import {
  isDaemonUp, getFolderConfig, getConfigDevices, getDeviceId, readPath, scanFolder,
  stopDaemon, startDaemon, getDaemonEvents, lastDaemonEventId, syncthingCommandLines, holdsValidVersion,
  waitForDaemonEvent, folderSaved, itemFinished,
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
//   - A planned shutdown pauses every folder. A node back within its shutdown
//     announcement keeps its role: the other holder waits for it.
//   - A primary that crashed returns paused, another holder has taken over,
//     and what it wrote while down is discarded, unsent.
//   - A primary returning while the other holder cannot be judged stays paused.
//     Once no other holder runs the component, what it wrote goes out. Each
//     holder's calls to the other reach the third node instead, which is what
//     keeps either from judging the other.
//
// Throughout, at most one node runs the component.

const APP_UID = 1000;
const API_PORT = 16127;
// How long an identity verdict is held, so a redirect put in or taken out is
// noticed within a pass or two.
const IDENTITY_TTL_MS = 5000;
// A shutdown announcement long enough to reboot inside, and locations that
// outlive every return below.
const SIGTERM_EXPIRY_S = 120;
const LOCATION_TTL_S = 600;

describe('a returning node waits paused until its role is decided', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eswpaused${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const folder = `flux${identifier}`;
  const data = `/mnt/appdata/flux-apps/${folder}/appdata`;
  const ARCANE = 0;
  const LEGACY = 1;
  const BYSTANDER = 2;
  const HOLDERS = [ARCANE, LEGACY];

  const client = (i) => env.clients[i];
  const sh = async (i, command) => execInContainer(client(i).container, command);
  const runners = async () => {
    const running = await Promise.all(HOLDERS.map((i) => isAppContainerRunning(client(i).container, appName)));
    return HOLDERS.filter((_, k) => running[k]);
  };
  // Sampled for the whole of each test, not only where it waits: at most one
  // node runs the component.
  let writerWatch = null;
  beforeEach(() => {
    const seen = [];
    const timer = setInterval(() => {
      runners().then((running) => { if (running.length > 1) seen.push(running); }).catch(() => {});
    }, 2000);
    writerWatch = () => {
      clearInterval(timer);
      expect(seen, 'moments when more than one node ran the component').to.deep.equal([]);
    };
  });
  afterEach(() => writerWatch?.());

  const folderIs = async (i, fields) => {
    const config = await getFolderConfig(client(i), folder);
    return !!config && Object.entries(fields).every(([key, value]) => config[key] === value);
  };
  // A file the app's own user wrote into the node's copy, then scanned where the
  // folder can send.
  const writeAsApp = async (i, name, content) => {
    const r = await sh(i, `printf '${content}' > ${data}/${name} && chown ${APP_UID}:${APP_UID} ${data}/${name}`);
    expect(r.exitCode, `fixture: ${r.output}`).to.equal(0);
  };
  // FluxOS's event on node i after `afterId`, matching `match`.
  const fluxEvent = (i, name, match, afterId, timeout = 300000) => client(i).waitForEvent(name, match, timeout, { afterId });
  const becamePrimary = (i, afterId, timeout) => fluxEvent(i, 'primaryRole:changed',
    (d) => d.identifier === identifier && d.to === 'primary', afterId, timeout);
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
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          peerIdentityVerifiedTtlMs: IDENTITY_TTL_MS,
          peerIdentityMisroutedTtlMs: IDENTITY_TTL_MS,
          sigtermExpiryS: SIGTERM_EXPIRY_S,
          locationTtlS: LOCATION_TTL_S,
        },
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
    const legacyFrom = await lastDaemonEventId(client(LEGACY));
    await installOnNodes(env, app, [LEGACY]);
    await waitForDaemonEvent(client(LEGACY), itemFinished(folder, 'appdata/placed.txt', 'update'), {
      since: legacyFrom, timeout: 300000, label: 'the legacy standby receiving the primary\'s data',
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

    // It received the primary's data, so the folder was unpaused before now.
    expect(await folderIs(LEGACY, { type: 'receiveonly', paused: false }), 'the standby\'s folder').to.equal(true);
    expect(await pausedPeerDevices(LEGACY), 'peer devices left paused').to.deep.equal([]);
  });

  it('pauses nothing when FluxOS alone restarts', async function () {
    this.timeout(300000);
    const since = await lastDaemonEventId(client(ARCANE));
    const mark = client(ARCANE).getLastEventId();
    const pid = (await sh(ARCANE, 'cat /tmp/fluxos.pid')).stdout.trim();
    expect(pid, 'fixture: no FluxOS pid').to.match(/^\d+$/);

    // SIGTERM with no system shutdown under way: the service restarting.
    await sh(ARCANE, `kill -TERM ${pid}`);
    // Two passes of the FluxOS that comes back: the folder write of the first has
    // landed once the second publishes.
    const first = await fluxEvent(ARCANE, 'syncthing:passComplete', () => true, mark);
    await fluxEvent(ARCANE, 'syncthing:passComplete', () => true, first.id);

    expect(client(ARCANE).getEventBuffer().filter((e) => e.event === 'shutdown:paused' && e.id > mark), 'a shutdown that paused').to.deep.equal([]);
    const paused = (await getDaemonEvents(client(ARCANE), { since, events: ['ConfigSaved'] }))
      .filter((event) => savedFolder(event)?.paused);
    expect(paused, 'a config write that paused the folder').to.deep.equal([]);
    expect(await runners(), 'the writer').to.deep.equal([ARCANE]);
  });

  it('brings a legacy standby\'s crashed syncthing back paused, and receiving again', async function () {
    this.timeout(300000);
    const mark = client(LEGACY).getLastEventId();
    await stopDaemon(client(LEGACY));

    // FluxOS starts it again, and its monitor resumes the devices the start paused.
    await fluxEvent(LEGACY, 'syncthing:devicesResumed', () => true, mark, 180000);
    (await syncthingCommandLines(client(LEGACY))).forEach((line) => expect(line).to.include('--paused'));
    await waitForDaemonEvent(client(LEGACY), folderSaved(folder, { type: 'receiveonly', paused: false }), {
      timeout: 120000, label: 'the standby\'s folder unpaused, receiving',
    });

    const since = await lastDaemonEventId(client(LEGACY));
    await writeAsApp(ARCANE, 'after-legacy-restart.txt', 'written on the primary');
    await scanFolder(client(ARCANE), folder);
    await waitForDaemonEvent(client(LEGACY), itemFinished(folder, 'appdata/after-legacy-restart.txt', 'update'), {
      since, timeout: 120000, label: 'the primary\'s write arriving on the standby',
    });
  });

  it('keeps the primary sending through its own syncthing restarting paused, as the ISO unit starts it', async function () {
    this.timeout(300000);
    const mark = client(ARCANE).getLastEventId();
    await stopDaemon(client(ARCANE));
    await startDaemon(client(ARCANE), { paused: true });

    // FluxOS finds the peer devices the paused start left paused, and resumes them.
    const resumed = await fluxEvent(ARCANE, 'syncthing:devicesResumed', () => true, mark, 120000);
    expect(resumed.data.devices, 'the peer devices the paused start left paused').to.include(await getDeviceId(client(LEGACY)));
    await waitForDaemonEvent(client(ARCANE), folderSaved(folder, { type: 'sendreceive', paused: false }), {
      timeout: 120000, label: 'the primary\'s folder unpaused, sending',
    });
    expect(await runners(), 'the writer').to.deep.equal([ARCANE]);

    const since = await lastDaemonEventId(client(LEGACY));
    await writeAsApp(ARCANE, 'after-arcane-restart.txt', 'written after the restart');
    await scanFolder(client(ARCANE), folder);
    await waitForDaemonEvent(client(LEGACY), itemFinished(folder, 'appdata/after-arcane-restart.txt', 'update'), {
      since, timeout: 120000, label: 'the primary\'s write arriving on the standby',
    });
  });

  it('keeps the primary sending through its own syncthing restarting unpaused, as ArcaneOS starts it before the release that passes --paused', async function () {
    this.timeout(300000);
    await stopDaemon(client(ARCANE));
    await startDaemon(client(ARCANE), { paused: false });
    expect((await syncthingCommandLines(client(ARCANE))).some((line) => line.includes('--paused')), 'fixture: a syncthing started with --paused').to.equal(false);

    // Two passes of FluxOS over the restarted daemon: the second began after it answered.
    const mark = client(ARCANE).getLastEventId();
    const first = await fluxEvent(ARCANE, 'syncthing:passComplete', () => true, mark);
    await fluxEvent(ARCANE, 'syncthing:passComplete', () => true, first.id);

    expect(client(ARCANE).getEventBuffer().filter((e) => e.event === 'syncthing:devicesResumed' && e.id > mark), 'peer devices found paused').to.deep.equal([]);
    // The daemon's event ids restart with it, so its whole log is since this start.
    const paused = (await getDaemonEvents(client(ARCANE), { events: ['ConfigSaved'] }))
      .filter((event) => savedFolder(event)?.paused);
    expect(paused, 'a config write that paused the folder').to.deep.equal([]);
    expect(await runners(), 'the writer').to.deep.equal([ARCANE]);

    const since = await lastDaemonEventId(client(LEGACY));
    await writeAsApp(ARCANE, 'after-unpaused-restart.txt', 'written after the restart');
    await scanFolder(client(ARCANE), folder);
    await waitForDaemonEvent(client(LEGACY), itemFinished(folder, 'appdata/after-unpaused-restart.txt', 'update'), {
      since, timeout: 120000, label: 'the primary\'s write arriving on the standby',
    });
  });

  it('pauses every folder on a planned shutdown, and keeps the role of a node back within its announcement', async function () {
    this.timeout(600000);
    const mark = client(ARCANE).getLastEventId();
    const standbyMark = client(LEGACY).getLastEventId();
    const restartingFrom = await client(LEGACY).getDecisionCount('peer:silenceVerdict', identifier, 'restarting');
    // The syncthing the next boot starts has no --paused, as on the fleet before
    // the ISO carries it: the pause the shutdown left is all that holds it.
    await shutdownFluxosGracefully(client(ARCANE).container, { hold: true, stopSyncthingAfter: true });
    const paused = await fluxEvent(ARCANE, 'shutdown:paused', () => true, mark, 10000);
    expect(paused.data.paused, 'the folders the shutdown paused').to.include(folder);
    await waitFor(async () => await client(LEGACY).getDecisionCount('peer:silenceVerdict', identifier, 'restarting') > restartingFrom, {
      timeout: 60000, interval: 2000, label: 'the other holder waiting for the node that announced its shutdown',
    });

    await startDaemon(client(ARCANE), { paused: false });
    expect(await folderIs(ARCANE, { type: 'sendreceive', paused: true }), 'fixture: the folder the shutdown paused').to.equal(true);
    const since = await lastDaemonEventId(client(ARCANE));
    await releaseFluxos(client(ARCANE).container);
    // Its folder sends again, unpaused - whether its election or its paused return
    // reaches the folder first.
    await waitForDaemonEvent(client(ARCANE), folderSaved(folder, { type: 'sendreceive', paused: false }), {
      since, timeout: 300000, label: 'the returned node\'s folder sending again',
    });
    await waitFor(async () => (await runners()).includes(ARCANE), {
      timeout: 180000, interval: 2000, label: 'the returned node runs the app again',
    });

    expect(client(LEGACY).getEventBuffer().filter((e) => e.event === 'primaryRole:changed' && e.id > standbyMark
      && e.data?.identifier === identifier && e.data?.to === 'primary'), 'the other holder taking over from a rebooting node').to.deep.equal([]);
    expect(await runners(), 'the writer').to.deep.equal([ARCANE]);
  });

  it('discards what a crashed primary wrote while away once another holder runs it', async function () {
    this.timeout(900000);
    const standbyMark = client(LEGACY).getLastEventId();
    // The whole machine, with no announcement: the process, the container and the
    // daemon.
    await crashFluxos(client(ARCANE).container, { hold: true });
    await execInContainer(client(ARCANE).container, `docker kill flux${identifier}`);
    await stopDaemon(client(ARCANE));
    await becamePrimary(LEGACY, standbyMark, 600000);

    // Written on the node that went, after it went: nothing peers have.
    await writeAsApp(ARCANE, 'written-while-away.txt', 'never sent');
    // As the ISO unit starts it.
    await startDaemon(client(ARCANE), { paused: true });
    expect(await folderIs(ARCANE, { type: 'sendreceive', paused: true }), 'fixture: the folder came back paused').to.equal(true);

    const returned = client(ARCANE).getLastEventId();
    await releaseFluxos(client(ARCANE).container);
    const decision = await fluxEvent(ARCANE, 'primaryRole:returned', () => true, returned);
    expect(decision.data, 'what the returning node decided').to.deep.equal({ identifier, outcome: 'discarded' });
    // syncthing answers a revert once it is done, and the event follows the answer.
    await fluxEvent(ARCANE, 'syncthing:localChangesReverted', (d) => d.folder === folder && d.files > 0, returned);
    expect(await readPath(client(ARCANE), `${data}/written-while-away.txt`), 'the unsent write on the returned node').to.equal(null);

    // Every config the returned node's daemon held since it started: never one
    // in which the folder sent unpaused.
    const sentUnpaused = (await getDaemonEvents(client(ARCANE), { events: ['ConfigSaved'] }))
      .filter((e) => savedFolder(e)?.type === 'sendreceive' && !savedFolder(e).paused);
    expect(sentUnpaused, 'a config in which the returned node\'s folder sent').to.deep.equal([]);
    expect(await folderIs(ARCANE, { type: 'receiveonly', paused: false }), 'the returned node\'s folder').to.equal(true);
    expect(await readPath(client(LEGACY), `${data}/written-while-away.txt`), 'the unsent write on the new primary').to.equal(null);
    expect(await holdsValidVersion(client(LEGACY), folder, 'appdata/written-while-away.txt'), 'a version of the unsent write on the new primary').to.equal(false);
    expect(await runners(), 'the writer').to.deep.equal([LEGACY]);
  });

  describe('a primary returning while the other holder cannot be judged', () => {
    // Each holder's calls to the other's API land on the node that holds nothing,
    // which answers as itself: neither can rule the other out. The returning
    // primary cannot judge the Arcane node, and the Arcane node cannot take over
    // while the primary is down.
    const addr = (i) => `${client(i).ip}:${API_PORT}`;
    const misrouted = (from, to) => client(from).getDecisionCount('peerIdentity:verdict', addr(to), 'misrouted');
    const redirects = {};
    const redirect = async (from, to) => {
      redirects[from] = await redirectOutbound(client(from).container, {
        toIps: [client(to).ip], ports: String(API_PORT), landsOn: client(BYSTANDER).ip, resetOpen: true,
      });
    };
    const clearRedirect = async (from) => {
      if (redirects[from]) await clearOutboundRedirect(client(from).container, redirects[from]);
      delete redirects[from];
    };
    let returned = 0;
    let arcaneFrom = 0;

    after(async () => {
      await clearRedirect(LEGACY);
      await clearRedirect(ARCANE);
    });

    it('stays paused, and sends nothing, while the other holder cannot be ruled out', async function () {
      this.timeout(600000);
      arcaneFrom = client(ARCANE).getLastEventId();
      const arcaneMisroutedFrom = await misrouted(ARCANE, LEGACY);
      await redirect(ARCANE, LEGACY);
      await redirect(LEGACY, ARCANE);
      await waitFor(async () => await misrouted(ARCANE, LEGACY) > arcaneMisroutedFrom, {
        timeout: 120000, interval: 2000, label: 'fixture: the Arcane node finds its calls to the primary answered by another node',
      });

      // The whole machine: the process, the container and the daemon.
      await crashFluxos(client(LEGACY).container, { hold: true });
      await execInContainer(client(LEGACY).container, `docker kill flux${identifier}`);
      await stopDaemon(client(LEGACY));
      await writeAsApp(LEGACY, 'written-while-down.txt', 'sent once it is safe');

      returned = client(LEGACY).getLastEventId();
      // The counters start again with the FluxOS that returns.
      await releaseFluxos(client(LEGACY).container);
      await waitFor(async () => await heldPausedPasses(LEGACY) >= 3, {
        timeout: 300000, interval: 3000, label: 'three passes that kept the returned primary paused',
      });

      expect(await misrouted(LEGACY, ARCANE), 'fixture: the returned primary\'s calls to the Arcane node answered by another node').to.be.above(0);
      expect(await folderIs(LEGACY, { type: 'sendreceive', paused: true }), 'the returned primary\'s folder').to.equal(true);
      expect(client(LEGACY).getEventBuffer().filter((e) => e.event === 'primaryRole:returned' && e.id > returned),
        'a decision made while the holder could not be ruled out').to.deep.equal([]);
      expect(client(ARCANE).getEventBuffer().filter((e) => e.event === 'primaryRole:changed' && e.id > arcaneFrom),
        'fixture: the Arcane node changed role while the primary was down').to.deep.equal([]);
      expect(await holdsValidVersion(client(ARCANE), folder, 'appdata/written-while-down.txt'), 'a version of the write on the other holder').to.equal(false);
    });

    it('sends what it wrote while down once no other holder runs the component', async function () {
      this.timeout(600000);
      const since = await lastDaemonEventId(client(ARCANE));
      const marks = HOLDERS.map((i) => client(i).getLastEventId());
      await clearRedirect(LEGACY);

      const decision = await fluxEvent(LEGACY, 'primaryRole:returned', () => true, returned);
      expect(decision.data, 'what the returning node decided').to.deep.equal({ identifier, outcome: 'kept' });
      await waitForDaemonEvent(client(ARCANE), itemFinished(folder, 'appdata/written-while-down.txt', 'update'), {
        since, timeout: 240000, label: 'the write arriving on the other holder',
      });
      expect(client(ARCANE).getEventBuffer().filter((e) => e.event === 'primaryRole:changed' && e.id > arcaneFrom),
        'fixture: the Arcane node changed role before the returned primary decided').to.deep.equal([]);

      await clearRedirect(ARCANE);
      const primary = await Promise.any(HOLDERS.map((i) => becamePrimary(i, marks[i], 600000).then(() => i)));
      expect(await readPath(client(primary), `${data}/written-while-down.txt`), 'the write on the node that runs the app').to.equal('sent once it is safe');
    });
  });
});
