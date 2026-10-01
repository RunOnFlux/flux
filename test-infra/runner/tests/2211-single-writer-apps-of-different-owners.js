import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, crashFluxos, releaseFluxos } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, electionDecisionCount } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, scanFolder, statPath, stopDaemon, startDaemon,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { authenticate } from '../auth.js';
import { appOwnerKey, otherOwnerKeys, userKey } from '../framework/keys.js';
import { followPrimary } from '../framework/fdm-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Three single-writer (g:) apps, each of a different owner, on overlapping
// holders of real syncthing daemons. Every node but the last holds two of them
// in different roles, so whatever happens to one app happens on nodes the
// others live on too. Each test moves one app, or one node, and asserts both
// that the subject moved as it should and that the other apps did not move at
// all.
//
// A's name is a prefix of B's, and A's junior standby is B's primary: a node
// running B read as running A would leave A's senior standby holding back from
// a takeover that is its to make.
//
// FDM follows each app's primary, as it does in production.

const APP_UID = 1000;
const HELD_PASSES = 3;
const NOBODY = 4;

describe('single-writer apps of different owners on shared holders', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const stamp = Date.now();
  const [ownerTwo, ownerThree] = otherOwnerKeys();
  // order: placement order, so election order - primary, senior standby, junior.
  const apps = [
    { tag: 'A', name: `e2eowners${stamp}`, key: appOwnerKey(), order: [0, 2, 1] },
    { tag: 'B', name: `e2eowners${stamp}1`, key: ownerTwo, order: [1, 2, 3] },
    { tag: 'C', name: `e2eothers${stamp}`, key: ownerThree, order: [2, 3, 0] },
  ].map((app) => ({
    ...app,
    identifier: `${app.name}_${app.name}`,
    folder: `flux${app.name}_${app.name}`,
    data: `/mnt/appdata/flux-apps/flux${app.name}_${app.name}/appdata`,
  }));
  const [A, B, C] = apps;
  const NODES = [0, 1, 2, 3, NOBODY];

  const client = (i) => env.clients[i];
  const sh = async (i, command) => execInContainer(client(i).container, command);
  const others = (subject) => apps.filter((app) => app !== subject);

  // The app's own container, by its exact name: a match on the app name alone
  // counts B's container as A's.
  const container = async (i, app) => {
    const r = await sh(i, `docker inspect -f '{{.State.Running}} {{.Id}} {{.State.StartedAt}}' ${app.folder} 2>/dev/null; true`);
    const [running, id, startedAt] = r.stdout.trim().split(' ');
    return running === 'true' ? { id, startedAt } : null;
  };
  const runners = async (app) => {
    const found = await Promise.all(app.order.map((i) => container(i, app)));
    return app.order.filter((_, k) => found[k]);
  };
  // Asserted on every poll of every wait that moves an app.
  const oneWriterEach = async () => {
    const all = await Promise.all(apps.map(runners));
    apps.forEach((app, k) => expect(all[k].length, `more than one node runs ${app.tag}: ${all[k].join(', ')}`).to.be.at.most(1));
    return all;
  };
  const folderType = async (i, app) => (await getFolderConfig(client(i), app.folder))?.type;
  const ownerAuth = async (i, key) => (await authenticate(client(i).url, key)).zelidauth;

  // Where an app runs and the exact container running it, for "did not move".
  const placement = async (app) => {
    const [runner] = await runners(app);
    return { runner, container: runner === undefined ? null : await container(runner, app) };
  };
  // The role changes a node published for an app after `from`.
  const roleChanges = (i, app, from) => client(i).getEventBuffer().filter((e) => e.id > from
    && e.event === 'primaryRole:changed' && e.data?.identifier === app.identifier);
  const lastIds = () => NODES.map((i) => client(i).getLastEventId());
  // Whether a node's stream carried any event about an app after `from`.
  const heardOf = (i, app, from) => client(i).getEventBuffer().some((e) => e.id > from
    && (e.data?.identifier === app.identifier || e.data?.folder === app.folder));
  // The apps other than `subject` sit where they sat, in the same containers,
  // with no role change on any node in `watched` since `from`. The canary is an
  // event about the subject on the same streams over the same window: an empty
  // stream would pass the rest.
  const othersStill = async (subject, before, from, watched) => {
    for (const app of others(subject)) {
      // eslint-disable-next-line no-await-in-loop
      expect(await placement(app), `${app.tag} moved while ${subject.tag} did`).to.deep.equal(before[app.tag]);
      for (const i of watched) {
        expect(roleChanges(i, app, from[i]).map((e) => e.data), `node ${i} changed ${app.tag}'s role`).to.deep.equal([]);
      }
    }
    expect(watched.some((i) => heardOf(i, subject, from[i])), `no stream carried an event about ${subject.tag}`)
      .to.equal(true);
  };
  const placements = async () => Object.fromEntries(await Promise.all(apps.map(async (app) => [app.tag, await placement(app)])));

  // Each standby of an app runs HELD_PASSES more election passes over it.
  const passesFromNow = async (app, nodes) => {
    const from = await Promise.all(nodes.map((i) => electionDecisionCount(client(i), app.identifier, 'evaluated')));
    await Promise.all(nodes.map((i, k) => waitFor(async () => {
      await oneWriterEach();
      return (await electionDecisionCount(client(i), app.identifier, 'evaluated')) >= from[k] + HELD_PASSES;
    }, { timeout: 180000, interval: 1000, label: `node ${i} ran ${HELD_PASSES} election passes over ${app.tag}` })));
  };

  before(async function () {
    this.timeout(1500000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES.length,
      legacyNodes: [1, 3],
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

    for (const app of apps) {
      // eslint-disable-next-line no-await-in-loop
      await followPrimary(app.name, { nodes: app.order.map((i) => new URL(client(i).url).host), gNames: [app.folder] });
      // eslint-disable-next-line no-await-in-loop
      await pushTestApp(app.name, 'v1', `owners${app.tag}`, { user: APP_UID });
      // eslint-disable-next-line no-await-in-loop
      app.spec = await buildSeedableApp({
        env,
        name: app.name,
        instances: app.order.length,
        ownerKey: app.key,
        compose: [{
          name: app.name,
          description: `single-writer app ${app.tag}`,
          repotag: `${REGISTRY_REPO_HOST}/${app.name}:v1`,
          ports: [],
          domains: [''],
          environmentParameters: [`WRITE_FILE=/appdata/placed-${app.tag}.txt`, `WRITE_CONTENT=${app.tag}`],
          commands: [],
          containerPorts: [80],
          containerData: 'g:/appdata',
          cpu: 0.1,
          ram: 100,
          hdd: 1,
          repoauth: '',
        }],
      });
      // Placed one holder at a time, so each app's election order is its order.
      const [primary, ...standbys] = app.order;
      // eslint-disable-next-line no-await-in-loop
      await installOnNodes(env, app.spec, [primary]);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(async () => (await container(primary, app)) !== null, {
        timeout: 300000, interval: 3000, label: `node ${primary} runs ${app.tag}`,
      });
      for (const i of standbys) {
        // eslint-disable-next-line no-await-in-loop
        await installOnNodes(env, app.spec, [i]);
        // eslint-disable-next-line no-await-in-loop
        await waitFor(() => isFolderSynced(client(i), app.folder), {
          timeout: 300000, interval: 3000, label: `node ${i} has ${app.tag}'s data`,
        });
      }
    }
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('runs each app on its own primary, sends each folder only from there, and keeps each app\'s data to itself', async function () {
    this.timeout(600000);
    for (const app of apps) {
      // eslint-disable-next-line no-await-in-loop
      expect(await runners(app), `${app.tag} runs on its primary alone`).to.deep.equal([app.order[0]]);
      for (const i of app.order) {
        // eslint-disable-next-line no-await-in-loop
        await waitFor(async () => (await folderType(i, app)) === (i === app.order[0] ? 'sendreceive' : 'receiveonly'), {
          timeout: 120000, interval: 2000, label: `node ${i}'s copy of ${app.tag} is ${i === app.order[0] ? 'sendreceive' : 'receiveonly'}`,
        });
      }
    }

    // Each node holds exactly the components it is primary for.
    for (const i of NODES) {
      // eslint-disable-next-line no-await-in-loop
      const held = (await client(i).get('/apps/heldcomponents')).data
        .filter((name) => apps.some((app) => app.folder === name));
      expect([...held].sort(), `node ${i} holds`).to.deep.equal(apps.filter((app) => app.order[0] === i).map((app) => app.folder).sort());
    }

    // A file written to one app reaches that app's copies and no other app's.
    for (const app of apps) {
      const primary = app.order[0];
      // eslint-disable-next-line no-await-in-loop
      const r = await sh(primary, `printf '${app.tag}' > ${app.data}/only-${app.tag}.txt`);
      expect(r.exitCode, `fixture: ${r.output}`).to.equal(0);
      // eslint-disable-next-line no-await-in-loop
      await scanFolder(client(primary), app.folder);
    }
    for (const app of apps) {
      for (const i of app.order.slice(1)) {
        // eslint-disable-next-line no-await-in-loop
        await waitFor(async () => (await statPath(client(i), `${app.data}/only-${app.tag}.txt`)) !== null, {
          timeout: 180000, interval: 3000, label: `${app.tag}'s file reached node ${i}`,
        });
      }
    }
    for (const app of apps) {
      for (const i of app.order) {
        for (const other of others(app)) {
          // eslint-disable-next-line no-await-in-loop
          expect(await statPath(client(i), `${app.data}/only-${other.tag}.txt`), `${other.tag}'s file in node ${i}'s copy of ${app.tag}`)
            .to.equal(null);
        }
      }
    }
  });

  it('lets an owner stop and start their own app, and nobody else\'s', async function () {
    this.timeout(300000);
    const user = userKey();
    for (const app of apps) {
      const primary = app.order[0];
      for (const key of [...others(app).map((other) => other.key), user]) {
        // eslint-disable-next-line no-await-in-loop
        const auth = await ownerAuth(primary, key);
        // eslint-disable-next-line no-await-in-loop
        const refused = await client(primary).getAuthed(`/apps/appstop/${app.name}`, auth);
        expect(refused?.data?.name, `${key.label} stopping ${app.tag}: ${JSON.stringify(refused)}`).to.equal('Unauthorized');
      }
      // eslint-disable-next-line no-await-in-loop
      expect(await runners(app), `${app.tag} still runs after every refusal`).to.deep.equal([primary]);
    }
  });

  it('holds an owner-stopped app on its primary, with no standby taking it and no other app moving', async function () {
    this.timeout(600000);
    const before = await placements();
    const from = lastIds();
    const [primary, ...standbys] = A.order;
    const startedBefore = await Promise.all(standbys.map((i) => electionDecisionCount(client(i), A.identifier, 'started')));
    const auth = await ownerAuth(primary, A.key);

    const stopped = await client(primary).getAuthed(`/apps/appstop/${A.name}`, auth);
    expect(stopped?.status, `owner stop: ${JSON.stringify(stopped)}`).to.equal('success');
    await waitFor(async () => (await container(primary, A)) === null, {
      timeout: 120000, interval: 2000, label: 'A stops on its primary',
    });
    await passesFromNow(A, standbys);
    const startedAfter = await Promise.all(standbys.map((i) => electionDecisionCount(client(i), A.identifier, 'started')));
    expect(startedAfter, 'a standby started the stopped app').to.deep.equal(startedBefore);
    expect(await runners(A), 'A runs somewhere while its owner has it stopped').to.deep.equal([]);

    const started = await client(primary).getAuthed(`/apps/appstart/${A.name}`, auth);
    expect(started?.status, `owner start: ${JSON.stringify(started)}`).to.equal('success');
    await waitFor(async () => {
      const [running] = await oneWriterEach();
      return running.length === 1;
    }, { timeout: 240000, interval: 2000, label: 'A runs again' });
    expect(await runners(A), 'A came back on its own primary').to.deep.equal([primary]);

    await othersStill(A, before, from, NODES);
  });

  it('moves only A when A\'s primary is lost, to its senior standby, while that node\'s other app stays put', async function () {
    this.timeout(900000);
    const before = await placements();
    const from = lastIds();
    const [lost, senior, junior] = A.order;
    const survivors = NODES.filter((i) => i !== lost);

    // Lost outright: FluxOS, the container and syncthing all gone, so every
    // holder's syncthing sees its connections drop.
    await crashFluxos(client(lost).container, { hold: true });
    try {
      await sh(lost, `docker kill ${A.folder}`);
      await stopDaemon(client(lost));

      await waitFor(async () => {
        const [running] = await oneWriterEach();
        return running.length === 1;
      }, { timeout: 480000, interval: 3000, label: 'A runs again after its primary is lost' });
      expect(await runners(A), `A moved to its senior standby, not past it to node ${junior} (which runs B)`).to.deep.equal([senior]);
      await waitFor(async () => (await folderType(senior, A)) === 'sendreceive', {
        timeout: 120000, interval: 2000, label: 'A\'s new primary sends',
      });
      expect(await folderType(junior, A), 'A\'s junior standby still receives').to.equal('receiveonly');

      // C's standby on the lost node is not C's business: C runs where it ran.
      for (const app of others(A)) {
        // eslint-disable-next-line no-await-in-loop
        expect(await placement(app), `${app.tag} moved while A failed over`).to.deep.equal(before[app.tag]);
      }
      await othersStill(A, before, from, survivors);
    } finally {
      await releaseFluxos(client(lost).container);
      await startDaemon(client(lost));
    }

    // Back, it holds A as a standby and C as a standby, and starts neither.
    await waitFor(async () => (await folderType(lost, A)) === 'receiveonly' && (await folderType(lost, C)) === 'receiveonly', {
      timeout: 240000, interval: 2000, label: 'the returned node receives A and C',
    });
    await passesFromNow(A, [lost]);
    await passesFromNow(C, [lost]);
    expect(await container(lost, A), 'the returned node runs A').to.equal(null);
    expect(await container(lost, C), 'the returned node runs C').to.equal(null);
    expect(await runners(A)).to.deep.equal([senior]);
    expect(await placement(C)).to.deep.equal(before.C);
  });

  it('keeps every role on a node whose FluxOS restarts while it is primary for two apps and standby for a third', async function () {
    this.timeout(600000);
    // After the failover A and C both run on node 2, which also holds B as a
    // standby. FluxOS restarts there and the containers do not.
    const node = 2;
    const primaryHere = apps.filter((app) => app === C || app === A);
    expect(await Promise.all(primaryHere.map(runners)), 'fixture: node 2 runs A and C').to.deep.equal([[node], [node]]);
    const before = await placements();
    const others2 = NODES.filter((i) => i !== node);
    const from = lastIds();

    const sample = async () => {
      await oneWriterEach();
      for (const app of primaryHere) {
        // eslint-disable-next-line no-await-in-loop
        expect(await folderType(node, app), `node ${node}'s copy of ${app.tag} stopped sending`).to.equal('sendreceive');
      }
      expect(await folderType(node, B), `node ${node}'s copy of B sends`).to.equal('receiveonly');
    };

    await crashFluxos(client(node).container, { hold: true });
    try {
      for (let k = 0; k < 5; k += 1) {
        // eslint-disable-next-line no-await-in-loop
        await sample();
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => { setTimeout(r, 2000); });
      }
    } finally {
      await releaseFluxos(client(node).container);
    }
    // Every holder, the restarted node included, runs its passes over every app.
    for (const app of apps) {
      // eslint-disable-next-line no-await-in-loop
      await passesFromNow(app, app.order.filter((i) => i !== node && i !== NOBODY));
      // eslint-disable-next-line no-await-in-loop
      await sample();
    }
    expect(await placements(), 'an app moved or its container was replaced').to.deep.equal(before);
    for (const app of apps) {
      for (const i of others2) {
        expect(roleChanges(i, app, from[i]).map((e) => e.data), `node ${i} changed ${app.tag}'s role`).to.deep.equal([]);
      }
    }
    // The streams those role changes would arrive on stayed live throughout.
    for (const i of others2) {
      expect(client(i).getEventBuffer().some((e) => e.id > from[i] && e.event === 'block:processed'), `node ${i}'s stream went quiet`)
        .to.equal(true);
    }
  });
});
