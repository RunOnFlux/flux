import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding, electionDecisionCount } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, getFolderStatus,
} from '../framework/syncthing-real.js';
import { followPrimary } from '../framework/fdm-control.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An owner stops a single-writer (g:) app on its primary and starts it again.
// The primary holds the app for the whole of it: stopped, its stop lock is what
// peers, FDM and its own folder monitor read as this node's; started, the lock
// stays until the primary's own election pass has decided. A standby never
// takes the app, the primary's folder never stops sending, and the app comes
// back on the primary.
//
// The window between the start and that decision is held open, not raced for:
// the primary's election is paused at the checkpoint before it decides the app,
// so whatever holds the app in that window has to hold it for as long as the
// test looks.

const BEFORE_DECISION = 'masterSlave:beforeDecision';
const HELD_PASSES = 3;

describe('an owner start keeps the primary', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eresume${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const folder = `flux${appName}_${appName}`;
  const PRIMARY = 0;
  const STANDBYS = [1, 2];
  const NODES = [PRIMARY, ...STANDBYS];
  let app;
  let auth;

  const client = (i) => env.clients[i];
  const running = async (i) => {
    const r = await execInContainer(client(i).container, `docker inspect -f '{{.State.Running}}' ${folder} 2>/dev/null; true`);
    return r.stdout.trim() === 'true';
  };
  const runners = async () => {
    const found = await Promise.all(NODES.map(running));
    return NODES.filter((_, k) => found[k]);
  };
  const folderType = async (i) => (await getFolderConfig(client(i), folder))?.type;
  const heldOnPrimary = async () => {
    const held = await client(PRIMARY).get('/apps/heldcomponents');
    if (held?.status !== 'success') throw new Error(`the primary's held account: ${JSON.stringify(held)}`);
    return held.data.includes(folder);
  };
  const started = () => Promise.all(STANDBYS.map((i) => electionDecisionCount(client(i), identifier, 'started')));
  const folderPasses = () => client(PRIMARY).getDecisionCount('syncthing:folderPass', folder, 'evaluated');
  const electionPasses = () => Promise.all(STANDBYS.map((i) => electionDecisionCount(client(i), identifier, 'evaluated')));

  // The primary holds the app and nobody runs it, asserted on every poll until
  // the primary's folder monitor and each standby's election have run
  // HELD_PASSES passes over it.
  const holdsThroughPasses = async (label) => {
    const fromFolder = await folderPasses();
    const fromElection = await electionPasses();
    const fromStarted = await started();
    await waitHolding(async () => {
      expect(await heldOnPrimary(), `${label}: the primary does not hold the app`).to.equal(true);
      expect(await folderType(PRIMARY), `${label}: the primary's folder`).to.equal('sendreceive');
      expect(await runners(), `${label}: the app runs`).to.deep.equal([]);
      expect(await started(), `${label}: a standby started the app`).to.deep.equal(fromStarted);
      const passes = await electionPasses();
      return (await folderPasses()) >= fromFolder + HELD_PASSES
        && passes.every((n, k) => n >= fromElection[k] + HELD_PASSES);
    }, {
      timeout: 300000, interval: 1000, label: `${label}: ${HELD_PASSES} folder passes on the primary and ${HELD_PASSES} election passes on each standby`,
    });
  };

  const stop = async () => {
    const res = await client(PRIMARY).getAuthed(`/apps/appstop/${appName}`, auth);
    expect(res?.status, `owner stop: ${JSON.stringify(res)}`).to.equal('success');
    await waitFor(async () => !(await running(PRIMARY)), {
      timeout: 120000, interval: 2000, label: 'the app stops on the primary',
    });
  };
  const start = async () => {
    const res = await client(PRIMARY).getAuthed(`/apps/appstart/${appName}`, auth);
    expect(res?.status, `owner start: ${JSON.stringify(res)}`).to.equal('success');
    return res;
  };
  const holdElection = async () => {
    const from = client(PRIMARY).getLastEventId();
    await client(PRIMARY).holdCheckpoint(BEFORE_DECISION, identifier);
    return from;
  };
  const electionParked = (from) => client(PRIMARY).waitForEvent(
    'checkpoint:held',
    (d) => d.name === BEFORE_DECISION && d.key === identifier,
    180000,
    { afterId: from },
  );

  before(async function () {
    this.timeout(1200000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES.length,
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

    await followPrimary(appName, { nodes: NODES.map((i) => new URL(client(i).url).host), gNames: [folder] });
    await pushTestApp(appName, 'v1', 'resume', { user: 1000 });
    app = await buildSeedableApp({
      env,
      name: appName,
      instances: NODES.length,
      compose: [{
        name: appName,
        description: 'an owner start keeps the primary',
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
    await waitFor(async () => (await runners()).includes(PRIMARY), {
      timeout: 300000, interval: 3000, label: 'the primary runs the app',
    });
    await waitFor(async () => (await getFolderStatus(client(PRIMARY), folder))?.localFiles > 0, {
      timeout: 120000, interval: 2000, label: 'the primary\'s syncthing holds the app\'s file',
    });
    await installOnNodes(env, app, STANDBYS);
    await Promise.all(STANDBYS.map((i) => waitFor(() => isFolderSynced(client(i), folder), {
      timeout: 300000, interval: 3000, label: `standby ${i} has the primary's data`,
    })));
    expect(await runners(), 'fixture: only the primary runs the app').to.deep.equal([PRIMARY]);
    auth = (await authenticate(client(PRIMARY).url, appOwnerKey())).zelidauth;
  });

  after(async function () {
    this.timeout(60000);
    await client(PRIMARY)?.releaseAllCheckpoints().catch(() => {});
    await env?.teardown();
  });

  it('holds the app on its primary from the start until the primary\'s election decides, then runs it there', async function () {
    this.timeout(900000);
    await stop();
    await holdsThroughPasses('stopped');

    const from = await holdElection();
    try {
      const res = await start();
      expect(res.data, 'the start waits on the election').to.include('waiting for the election');
      await electionParked(from);
      await holdsThroughPasses('started, the election not yet decided');
    } finally {
      await client(PRIMARY).releaseCheckpoint(BEFORE_DECISION, identifier);
    }

    await client(PRIMARY).waitForEvent(
      'masterSlave:operatorStartSettled',
      (d) => d.identifier === identifier,
      180000,
      { afterId: from },
    ).then((e) => expect(e.data.outcome, 'what the primary\'s election decided').to.equal('it starts here'));
    await waitHolding(async () => {
      const now = await runners();
      expect(now.length, `more than one node runs the app: ${now.join(', ')}`).to.be.at.most(1);
      return now.length === 1;
    }, { timeout: 240000, interval: 2000, label: 'the app runs again' });
    expect(await runners(), 'the app came back on its primary').to.deep.equal([PRIMARY]);
    expect(await folderType(PRIMARY), 'the primary\'s folder').to.equal('sendreceive');
  });

  it('keeps an app stopped when its owner stops it again before the election has decided the start', async function () {
    this.timeout(900000);
    await stop();

    const from = await holdElection();
    try {
      await start();
      await electionParked(from);
      await stop();
    } finally {
      await client(PRIMARY).releaseCheckpoint(BEFORE_DECISION, identifier);
    }

    await holdsThroughPasses('stopped again before the decision');
    const since = (event, match = () => true) => client(PRIMARY).getEventBuffer()
      .filter((e) => e.id > from && e.event === event && e.data?.identifier === identifier && match(e.data));
    expect(since('masterSlave:operatorStartSettled'), 'the election lifted the lock of a stop given after the start').to.deep.equal([]);
    // A desire to run left behind the lock would start the app the moment the
    // lock lifted, with no election pass.
    expect(since('reconciler:desiredChanged', (d) => d.state === 'running'), 'the election committed to run an app its owner had stopped').to.deep.equal([]);

    await start();
    await waitHolding(async () => {
      const now = await runners();
      expect(now.length, `more than one node runs the app: ${now.join(', ')}`).to.be.at.most(1);
      return now.length === 1;
    }, { timeout: 240000, interval: 2000, label: 'the app runs again' });
    expect(await runners(), 'the app came back on its primary').to.deep.equal([PRIMARY]);
  });
});
