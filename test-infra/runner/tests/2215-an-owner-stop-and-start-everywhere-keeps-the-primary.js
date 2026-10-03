// weight: heavy
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, isAppContainerRunning, crashFluxos, releaseFluxos } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes, electionIndexOf } from '../framework/reconciler-suite.js';
import {
  waitFor, waitHolding, waitForUp, electionDecisionCount,
} from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, stopDaemon, startDaemon,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An owner stops a single-writer (g:) app on every node at once and starts it
// on every node at once - the global stop and start the owner's tools send.
// The app comes back on the node that was its primary when it was stopped,
// not on whichever node the election order would pick.
//
// The primary is put below index 0 first, so the two are different nodes: the
// app runs on the first holder, that holder dies, the second takes the app
// over, and the first comes back as a standby still ranked ahead of it.
//
// Every wait asserts, on every poll, that at most one node runs the app.

const APP_UID = 1000;
const HELD_PASSES = 3;

describe('an owner stop and start everywhere keeps the primary', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eglobalresume${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const folder = `flux${identifier}`;
  // Placed in this order, so the election ranks them in it. A fourth node
  // holds nothing and keeps the discovery ring whole.
  const FIRST = 0;
  const PRIMARY = 1;
  const THIRD = 2;
  const HOLDERS = [FIRST, PRIMARY, THIRD];
  const STANDBYS = [FIRST, THIRD];
  let app;

  const client = (i) => env.clients[i];
  const runners = async () => {
    const running = await Promise.all(HOLDERS.map((i) => isAppContainerRunning(client(i).container, appName)));
    return HOLDERS.filter((_, k) => running[k]);
  };
  const oneWriterAtMost = async () => {
    const running = await runners();
    expect(running.length, `more than one node runs the app: ${running.join(', ')}`).to.be.at.most(1);
    return running;
  };
  const ownerAuth = async (i) => (await authenticate(client(i).url, appOwnerKey())).zelidauth;
  const globally = async (command, via) => {
    const res = await client(via).getAuthed(`/apps/${command}/${appName}/true`, await ownerAuth(via));
    expect(res?.status, `owner global ${command} through node ${via}: ${JSON.stringify(res)}`).to.equal('success');
  };
  const locally = async (command, i) => {
    const res = await client(i).getAuthed(`/apps/${command}/${appName}`, await ownerAuth(i));
    expect(res?.status, `owner ${command} on node ${i}: ${JSON.stringify(res)}`).to.equal('success');
  };
  const settled = (i, from) => client(i).getEventBuffer()
    .filter((e) => e.id > from && e.event === 'masterSlave:operatorStartSettled' && e.data?.identifier === identifier)
    .map((e) => e.data.outcome);
  const marks = () => Object.fromEntries(HOLDERS.map((i) => [i, client(i).getLastEventId()]));
  const evaluated = (nodes) => Promise.all(nodes.map((i) => electionDecisionCount(client(i), identifier, 'evaluated')));

  // Nothing runs the app, asserted on every poll, until each of `nodes` has run
  // HELD_PASSES election passes over it.
  const nothingRunsThroughPasses = async (nodes, label) => {
    const from = await evaluated(nodes);
    await waitHolding(async () => {
      expect(await runners(), `${label}: the app runs`).to.deep.equal([]);
      const now = await evaluated(nodes);
      return now.every((n, k) => n >= from[k] + HELD_PASSES);
    }, { timeout: 300000, interval: 2000, label: `${label}: ${HELD_PASSES} election passes on nodes ${nodes.join(', ')}` });
  };
  const stopsEverywhere = async (via) => {
    await globally('appstop', via);
    await waitHolding(async () => (await oneWriterAtMost()).length === 0, {
      timeout: 180000, interval: 2000, label: 'the app stops everywhere',
    });
  };
  const runsAgainOn = async (expected, label) => {
    await waitHolding(async () => (await oneWriterAtMost()).length === 1, {
      timeout: 300000, interval: 2000, label: `${label}: the app runs again`,
    });
    expect(await runners(), `${label}: where the app came back`).to.deep.equal([expected]);
    await waitFor(async () => (await getFolderConfig(client(expected), folder))?.type === 'sendreceive', {
      timeout: 120000, interval: 2000, label: `${label}: node ${expected}'s folder sends`,
    });
  };

  before(async function () {
    this.timeout(1500000);
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

    await pushTestApp(appName, 'v1', 'globalresume', { user: APP_UID });
    app = await buildSeedableApp({
      env,
      name: appName,
      instances: HOLDERS.length,
      compose: [{
        name: appName,
        description: 'an owner stop and start everywhere',
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

    // One at a time: a node learns of the app only when it is installed, so the
    // order is the placement order.
    await installOnNodes(env, app, [FIRST]);
    await waitForUp(client(FIRST), appName, 'the first holder runs the app', { timeout: 300000, interval: 3000 });
    for (const i of [PRIMARY, THIRD]) {
      // eslint-disable-next-line no-await-in-loop
      await installOnNodes(env, app, [i]);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => isFolderSynced(client(i), folder), {
        timeout: 300000, interval: 3000, label: `holder ${i} has the first holder's data`,
      });
    }

    // The first holder dies whole - process, container and daemon - and the
    // second takes the app over.
    await crashFluxos(client(FIRST).container, { hold: true });
    await execInContainer(client(FIRST).container, `docker kill ${folder}`);
    await stopDaemon(client(FIRST));
    await waitHolding(async () => (await oneWriterAtMost()).includes(PRIMARY), {
      timeout: 300000, interval: 3000, label: 'the second holder takes the app over',
    });

    // Then it comes back, as a standby still ranked ahead of the primary.
    await startDaemon(client(FIRST));
    await releaseFluxos(client(FIRST).container);
    await waitHolding(async () => {
      await oneWriterAtMost();
      return (await getFolderConfig(client(FIRST), folder))?.type === 'receiveonly';
    }, { timeout: 300000, interval: 2000, label: 'the first holder is back as a standby' });
    await waitFor(() => isFolderSynced(client(FIRST), folder), {
      timeout: 300000, interval: 3000, label: 'the first holder has the primary\'s data',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('runs the app on a primary the election order ranks below another holder', async function () {
    this.timeout(180000);
    expect(await runners(), 'the primary').to.deep.equal([PRIMARY]);
    expect(await electionIndexOf(env, appName, FIRST), 'the first holder\'s place').to.equal(0);
    expect(await electionIndexOf(env, appName, PRIMARY), 'the primary\'s place').to.equal(1);
  });

  it('brings the app back on its primary when its owner stops it everywhere and starts it everywhere', async function () {
    this.timeout(900000);
    await stopsEverywhere(PRIMARY);
    await nothingRunsThroughPasses(STANDBYS, 'stopped everywhere');

    const from = marks();
    const resumed = await electionDecisionCount(client(PRIMARY), identifier, 'primaryResumed');
    await globally('appstart', PRIMARY);
    await runsAgainOn(PRIMARY, 'started everywhere');

    expect(await electionDecisionCount(client(PRIMARY), identifier, 'primaryResumed'), 'the primary resumed it').to.be.above(resumed);
    await waitFor(async () => STANDBYS.every((i) => settled(i, from[i]).length > 0), {
      timeout: 180000, interval: 2000, label: 'every standby\'s election decided the start',
    });
    expect(settled(PRIMARY, from[PRIMARY]), 'what the primary decided').to.deep.equal(['it starts here']);
    STANDBYS.forEach((i) => expect(settled(i, from[i]), `what node ${i} decided`).to.deep.equal(['a peer holds it']));
  });

  it('brings it back on its primary after a second stop everywhere, given while nothing ran', async function () {
    this.timeout(900000);
    await stopsEverywhere(PRIMARY);
    await stopsEverywhere(FIRST);
    await nothingRunsThroughPasses(STANDBYS, 'stopped everywhere twice');

    await globally('appstart', THIRD);
    await runsAgainOn(PRIMARY, 'started everywhere after two stops');
  });

  it('runs it nowhere when its owner starts it on one standby alone, and on its primary once started everywhere', async function () {
    this.timeout(900000);
    await stopsEverywhere(PRIMARY);

    const from = marks();
    await locally('appstart', FIRST);
    await waitFor(async () => settled(FIRST, from[FIRST]).length > 0, {
      timeout: 180000, interval: 2000, label: 'the standby\'s election decided its start',
    });
    expect(settled(FIRST, from[FIRST]), 'what the standby decided').to.deep.equal(['a peer holds it']);
    await nothingRunsThroughPasses(STANDBYS, 'started on one standby');

    await globally('appstart', PRIMARY);
    await runsAgainOn(PRIMARY, 'then started everywhere');
  });

  it('runs it nowhere while its primary is down at the start, and on its primary once it is back and started again', async function () {
    this.timeout(1200000);
    await stopsEverywhere(PRIMARY);

    // Down for the start: the process only, so its syncthing is still connected
    // and nothing says it is gone.
    await crashFluxos(client(PRIMARY).container, { hold: true });
    let released = false;
    try {
      const from = marks();
      await globally('appstart', FIRST);
      await nothingRunsThroughPasses(STANDBYS, 'started everywhere with the primary down');

      await releaseFluxos(client(PRIMARY).container);
      released = true;
      // It missed the start, so its lock holds the app, and every standby that
      // took the start stands aside for it.
      await waitFor(async () => STANDBYS.every((i) => settled(i, from[i]).length > 0), {
        timeout: 300000, interval: 2000, label: 'every standby\'s election decided the start once the primary was back',
      });
      STANDBYS.forEach((i) => expect(settled(i, from[i]), `what node ${i} decided`).to.deep.equal(['a peer holds it']));
      await nothingRunsThroughPasses(HOLDERS, 'the primary back, without the start');
    } finally {
      if (!released) await releaseFluxos(client(PRIMARY).container).catch(() => {});
    }

    await globally('appstart', PRIMARY);
    await runsAgainOn(PRIMARY, 'started everywhere again');
  });
});
