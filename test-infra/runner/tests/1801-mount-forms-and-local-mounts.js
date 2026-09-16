import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import {
  isDaemonUp, getDeviceId, getConnectedDevices, getFolders, getFolderStatus, scanFolder,
  getLocalChanged,
} from '../framework/syncthing-real.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// The mount forms that put something on the volume the owner did not write, and
// what replication does with each.
//
// A component's volume root IS its syncthing folder, so every mount a spec declares
// lands inside the replicated tree: `m:` and `ml:` are mkdir'd there and `f:` is
// touched as a zero-length file, because docker creates a DIRECTORY when a bind
// source is missing and that would break a file mount. Until this suite existed the
// harness built `g:/appdata` and nothing else, so none of that scaffolding appeared
// in any fleet - while 256 apps on the network used `m:` and 13 used `f:`.
//
// `ml:` is the one that changes behaviour rather than shape: it names a directory
// the spec wants kept off the network, asserted through a .stignore derived from the
// spec so every node computes the same patterns. That is what lets a component hold
// something large it can obtain again for free - a game's content, a build cache -
// without the cluster carrying a copy per instance.
//
// Run against REAL syncthing daemons. The control-plane stub moves no files, so it
// can show a folder's configuration and never what crossed between two nodes, which
// is the whole claim here.

const appDir = (name) => `/mnt/appdata/flux-apps/flux${name}_${name}`;

async function sh(client, command) {
  return execInContainer(client.container, `sh -c '${command}'`);
}

// What this node tells a peer about to seed. `holding` is recorded once per monitor
// pass, only for folders still receiveonly, so a promoted folder answers with nothing.
async function holdingFor(client, folderId) {
  const body = await client.get('/apps/promotedfolders');
  if (body?.data?.ready !== true) return null;
  return body.data.holding?.[folderId] ?? null;
}

async function pathKind(client, path) {
  const r = await sh(client, `test -f ${path} && echo file; test -d ${path} && echo dir; true`);
  return r.stdout.trim();
}

describe('mount forms on a replicated volume, and the directory a spec keeps local', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2emounts${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const dir = appDir(appName);
  const nodes = [0, 1];

  before(async function () {
    this.timeout(600000);
    // Three nodes for the same reason suite 89 needs three: the discovery mesh is a
    // ring and needs 2*minOutgoing+1 to close. The app holds two of them.
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

    await Promise.all(env.clients.map((client, i) => waitFor(() => isDaemonUp(client), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({
      name: appName,
      mode: 'r',
      extraMounts: [
        'm:logs:/var/log/app',
        'ml:cache:/var/cache/app',
        'f:server.json:/etc/server.json',
      ],
    });
    const installAfters = nodes.map((i) => env.clients[i].getLastEventId());
    await installOnNodes(env, app, nodes);
    await Promise.all(nodes.map((i, k) => waitForReconcileActuated(
      env.clients[i], identifier, 'dataCleared', 120000, { afterId: installAfters[k] },
    )));
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('creates every declared mount on the volume, each as the kind its form names', async function () {
    this.timeout(180000);
    // A form that silently created the wrong kind would still pass a "the path
    // exists" check and then fail inside the container, where no suite is looking.
    await Promise.all(nodes.map(async (i) => {
      const client = env.clients[i];
      expect(await pathKind(client, `${dir}/appdata`), `node ${i} primary mount`).to.equal('dir');
      expect(await pathKind(client, `${dir}/logs`), `node ${i} m: mount`).to.equal('dir');
      expect(await pathKind(client, `${dir}/cache`), `node ${i} ml: mount`).to.equal('dir');
      expect(await pathKind(client, `${dir}/server.json`), `node ${i} f: mount`).to.equal('file');
    }));
  });

  it('excludes only the directory the spec declared local, and keeps the FluxOS lines leading', async function () {
    this.timeout(180000);
    await Promise.all(nodes.map(async (i) => {
      const read = await sh(env.clients[i], `cat ${dir}/.stignore`);
      const lines = read.stdout.split('\n').map((line) => line.trim()).filter(Boolean);

      expect(lines, `node ${i} excludes the ml: directory`).to.include('/cache');
      expect(lines, `node ${i} does not exclude the m: directory`).to.not.include('/logs');
      expect(lines, `node ${i} does not exclude the f: file`).to.not.include('/server.json');
      // syncthing takes the FIRST pattern that matches, so a policy line below
      // anything is a line something else can answer for.
      expect(lines.slice(0, 3), `node ${i} leading block`).to.deep.equal(['/backup', '/.flux-op-*', '/cache']);
    }));
  });

  it('seeds the cold start, though every mount form leaves scaffolding on the volume', async function () {
    this.timeout(300000);
    // Both nodes were placed at once with nothing seeded, so somebody has to go first.
    // Each one's daemon reports the scaffolding its own spec asked for - a zero-length
    // f: file, an m: and an ml: directory - as receive-only local changes against an
    // empty global index. Counted as data the cluster is missing, that makes both nodes
    // defer to each other and NEITHER seeds: the folder never leaves receiveonly, and
    // every assertion below it times out instead of failing.
    //
    // Only a real daemon can show this. The control-plane stub reports whatever a suite
    // scripted and cannot read the volume at all, so the shape is unreachable there -
    // which is why suite 51 stayed green through the live version of this bug.
    const [a, b] = env.clients;
    const folderId = `flux${appName}_${appName}`;

    await waitFor(async () => {
      const modes = await Promise.all([a, b].map(async (client) => {
        const folders = await getFolders(client).catch(() => []);
        return folders.find((folder) => folder.id === folderId)?.type;
      }));
      return modes.filter((mode) => mode === 'sendreceive').length === 1;
    }, { timeout: 240000, interval: 5000, label: 'exactly one node seeds the cold start' });
  });

  // The election's new question - not "is anyone running" but "who holds the owner's
  // data". The comparator is unit-tested (bestHolder, six cases built so that the
  // address order would answer each one differently), and what no unit test can reach
  // is whether the CLAIM it compares is computed correctly from a real volume.
  //
  // That claim is the `holding` of /apps/promotedfolders, derived from the daemon's own
  // receive-only change list - and every mount form this suite declares puts something
  // in that list which is not the owner's data: an m: and an ml: directory, and a
  // zero-length f: file whose mtime is the moment FluxOS built the volume. Counted,
  // a node holding nothing is newer than the node holding the customer's world, and
  // wins the seed. A stub cannot show any of this: it reports what a suite declared.
  it('claims the owner\'s data, and not the scaffolding every mount form leaves beside it', async function () {
    this.timeout(420000);
    const folderId = `flux${appName}_${appName}`;

    // The node that did NOT seed is the only one that publishes a claim at all:
    // holdings are recorded where they are computed, inside the receive-only
    // transition, so a promoted folder never refreshes one.
    const modes = await Promise.all(nodes.map(async (i) => {
      const list = await getFolders(env.clients[i]).catch(() => []);
      return list.find((folder) => folder.id === folderId)?.type;
    }));
    const emptyIndex = nodes[modes[0] === 'sendreceive' ? 1 : 0];
    const client = env.clients[emptyIndex];

    // THE CANARY. "Claims nothing" is equally true of a daemon that has not looked at
    // the volume yet, and that run would pass the assertion below having proved
    // nothing. So establish first that the scaffolding is in the list the claim is
    // derived from.
    let changed = null;
    await waitFor(async () => {
      const answer = await getLocalChanged(client, folderId).catch(() => null);
      changed = answer?.files?.length ? answer : null;
      return changed !== null;
    }, { timeout: 180000, interval: 5000, label: 'the daemon lists the scaffolding as receive-only local changes' });
    const names = changed.files.map((file) => file.name);
    expect(names, 'the f: file is on the volume, so the daemon must be listing it').to.include('server.json');

    // And the claim reads zero over exactly that list.
    const before = await holdingFor(client, folderId);
    expect(before, 'the node must have completed a pass, or it is not answering at all').to.exist;
    expect(before.bytes, 'scaffolding is not the owner\'s data').to.equal(0);
    expect(before.newestModified, 'and a zero-length file contributes no timestamp either').to.equal(0);

    // Now the owner's data lands on the same volume, and the same claim must carry it.
    await seedSyncScopedData(env, appName, emptyIndex);

    // Asked to look, rather than waiting on syncthing's own rescan interval - an hour by
    // default, so "has not noticed yet" and "never landed" would be one observation. And
    // waited on the ONE number that answers the question: an OR across two counters
    // passes on whichever is transiently true, which is how the first run of this
    // cleared its wait and then read back zero.
    await scanFolder(client, folderId);
    await waitFor(async () => {
      const status = await getFolderStatus(client, folderId).catch(() => null);
      return (status?.localBytes ?? 0) > 0;
    }, { timeout: 180000, interval: 5000, label: 'the daemon accounts for the bytes written into the volume' });

    let after = null;
    await waitFor(async () => {
      const held = await holdingFor(client, folderId);
      after = held && held.bytes > 0 ? held : null;
      return after !== null;
    }, { timeout: 180000, interval: 5000, label: 'the node claims the owner\'s data it now holds' });
    expect(after.newestModified, 'a claim carrying bytes must carry when they were written').to.be.greaterThan(0);
  });

  it('binds every declared mount to the volume, not to the container layer', async function () {
    this.timeout(180000);
    // The point of the whole mount model, and the one thing every other test here would
    // pass without: the rest check the HOST side. If a bind pointed somewhere else the
    // directory would still be created, still be excluded from .stignore and still not
    // replicate, while the app wrote into the container's own layer - which carries a
    // flat 10 GiB quota whatever the customer's hdd says, and is how an 8.2 GiB game
    // dies with `state is 0x202` on a 60 GB plan.
    //
    // Read from docker's mount table rather than by writing through each path: the test
    // image is a static binary with no shell, so there is nothing to exec. This is the
    // binding itself as docker recorded it, which is what decides where a write lands.
    const client = env.clients[nodes[0]];
    const container = `flux${appName}_${appName}`;
    const r = await execInContainer(client.container,
      `docker inspect ${container} --format '{{range .Mounts}}{{.Source}}=>{{.Destination}} {{end}}'`);
    expect(r.exitCode, `could not inspect ${container}: ${r.output}`).to.equal(0);
    const binds = r.stdout.trim();

    // Every declared form, and each must resolve INTO the app's volume directory.
    expect(binds, 'r: primary mount').to.include(`${dir}/appdata=>/appdata`);
    expect(binds, 'm: mount must bind to the volume').to.include(`${dir}/logs=>/var/log/app`);
    expect(binds, 'ml: mount must bind to the volume, not the container layer').to.include(`${dir}/cache=>/var/cache/app`);
    expect(binds, 'f: mount must bind the file itself').to.include(`${dir}/server.json=>/etc/server.json`);
  });

  it('replicates an m: directory and never an ml: one', async function () {
    this.timeout(420000);
    const [a, b] = env.clients;

    const ids = await Promise.all([getDeviceId(a), getDeviceId(b)]);
    expect(ids[0], 'the nodes must have distinct identities').to.not.equal(ids[1]);
    await waitFor(async () => (await getConnectedDevices(a)).includes(ids[1]), {
      timeout: 240000, interval: 5000, label: 'node 0 connected to node 1',
    });

    // Written in the same breath, so the m: file is this test's canary: "the ml:
    // file did not arrive" is also true of a run where nothing replicated at all,
    // and that run would pass a bare negative assertion while proving nothing.
    await sh(a, `echo replicated > ${dir}/logs/carried && echo local > ${dir}/cache/kept`);

    await waitFor(
      async () => (await pathKind(b, `${dir}/logs/carried`)) === 'file',
      { timeout: 300000, interval: 5000, label: 'the m: directory reaches the peer' },
    );

    expect(
      await pathKind(b, `${dir}/cache/kept`),
      'the ml: directory must not reach the peer - the canary above proves replication was running',
    ).to.equal('');
  });
});
