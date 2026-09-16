import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import {
  isDaemonUp, getDeviceId, getConnectedDevices, getFolders,
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
