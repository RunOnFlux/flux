import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { mirrorImage, pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitForUp } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, scanFolder, statPath, syncthingIdTables,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import numericIdTables from '../../../ZelBack/src/services/utils/numericIdTables.js';

const { TABLES_SHA256 } = numericIdTables;

// fleet: 3
//
// An app may run syncthing itself. On a legacy node FluxOS runs on the host, so
// the app's syncthing is a process named syncthing that FluxOS can see, in the
// app container's own PID namespace and resolving owners against the image's
// own passwd and group. It is the app's: FluxOS keeps its own syncthing running
// beside it, leaves the app's alone, and writes folder ownership as it would
// without it.
//
// The app is the published syncthing image. The two holders of the g: app give
// the same names different ids, as hosts do, so a name that travelled would land
// on the wrong id. A third node holds nothing: a node obtains the network policy
// only once it has as many peers as the harness's appSyncPeerThreshold.

const SYNCTHING_IMAGE = 'registry-1.docker.io/syncthing/syncthing:2.1.5';
const SYNCTHING_IMAGE_DIGEST = 'sha256:397aa00b92b48d65540ea3ae3cbf271b87bdccbe07a0b7bd7d2debc3a7b29138';

const USERS = ['stown0', 'stown1'];
const GROUPS = ['stgrp0', 'stgrp1'];
const nodeUid = (node, j) => 4101 + ((j + node) % 2);
const nodeGid = (node, j) => 4001 + ((j + node) % 2);

describe('an app\'s syncthing is the app\'s', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const stamp = Date.now();
  const syncthingApp = `e2eappsyncthing${stamp}`;
  const appName = `e2eownbeside${stamp}`;
  const folder = `flux${appName}_${appName}`;
  const data = `/mnt/appdata/flux-apps/${folder}/appdata`;
  const LEGACY = 0;
  const ARCANE = 1;

  const client = (i) => env.clients[i];
  const sh = async (i, command) => execInContainer(client(i).container, command);
  const counter = async (i, name) => (await client(i).getTestCounters())?.[name] ?? 0;
  const pids = async (i, command) => (await sh(i, `${command}; true`)).stdout.split('\n').map((p) => p.trim()).filter(Boolean).sort();
  // The node's own syncthing, and every process named syncthing the node can see.
  const nodeSyncthing = (i) => pids(i, 'pgrep -x syncthing --ns 1 --nslist pid');
  const anySyncthing = (i) => pids(i, 'pgrep -x syncthing');
  async function appSyncthing(i) {
    const own = await nodeSyncthing(i);
    return (await anySyncthing(i)).filter((pid) => !own.includes(pid));
  }

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

    await Promise.all(env.clients.map(async (c, node) => {
      const passwd = USERS.map((name, j) => `${name}:x:${nodeUid(node, j)}:${nodeGid(node, j)}::/nonexistent:/usr/sbin/nologin`).join('\\n');
      const group = GROUPS.map((name, j) => `${name}:x:${nodeGid(node, j)}:`).join('\\n');
      const r = await execInContainer(c.container, `printf '${passwd}\\n' >> /etc/passwd && printf '${group}\\n' >> /etc/group`);
      expect(r.exitCode, `fixture: names on node ${node}: ${r.output}`).to.equal(0);
    }));

    const views = await syncthingIdTables(client(LEGACY));
    expect(views.length && views.every((v) => v.tables === TABLES_SHA256), `fixture: the legacy node's syncthing has the tables: ${JSON.stringify(views)}`).to.equal(true);

    const image = await mirrorImage(SYNCTHING_IMAGE, null, { digest: SYNCTHING_IMAGE_DIGEST });
    const app = await buildSeedableApp({
      env,
      name: syncthingApp,
      instances: 1,
      compose: [{
        name: syncthingApp,
        description: 'an app that runs syncthing',
        repotag: image,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [8384],
        containerData: '/var/syncthing',
        cpu: 0.2,
        ram: 200,
        hdd: 1,
        repoauth: '',
      }],
    });
    await installOnNodes(env, app, [LEGACY]);
    await waitForUp(client(LEGACY), syncthingApp, 'the legacy node runs the syncthing app', { timeout: 300000, interval: 3000 });
    await waitFor(async () => (await appSyncthing(LEGACY)).length > 0, {
      timeout: 120000, interval: 2000, label: 'the app\'s syncthing runs',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('keeps its own syncthing running beside the app\'s, and leaves the app\'s alone', async function () {
    this.timeout(600000);
    const own = await nodeSyncthing(LEGACY);
    const apps = await appSyncthing(LEGACY);
    expect(own.length, 'fixture: the node runs its own syncthing').to.be.greaterThan(0);
    expect(apps.length, 'fixture: the app runs syncthing').to.be.greaterThan(0);
    const appTables = (await sh(LEGACY, `cat /proc/${apps[0]}/root/etc/passwd /proc/${apps[0]}/root/etc/group | sha256sum | cut -c1-64`)).stdout.trim();
    expect(appTables, 'fixture: the app\'s syncthing resolves owners against its own passwd and group').to.not.equal(TABLES_SHA256);

    const mark = client(LEGACY).getLastEventId();
    const passed = await counter(LEGACY, 'syncthing:supervisionPass');
    await waitFor(async () => (await counter(LEGACY, 'syncthing:supervisionPass')) >= passed + 3, {
      timeout: 400000, interval: 3000, label: 'three sentinel passes with the app\'s syncthing running',
    });

    expect(await nodeSyncthing(LEGACY), 'the node\'s own syncthing, across the passes').to.deep.equal(own);
    expect(await appSyncthing(LEGACY), 'the app\'s syncthing, across the passes').to.deep.equal(apps);
    const replaced = client(LEGACY).getEventBuffer().filter((e) => e.event === 'syncthing:namesVisible' && e.id > mark);
    expect(replaced, 'FluxOS took the app\'s syncthing for its own').to.deep.equal([]);
  });

  it('writes folder ownership while the app\'s syncthing runs', async function () {
    this.timeout(900000);
    const refusedBefore = await counter(LEGACY, 'syncthing:ownershipWriteRefused');

    await pushTestApp(appName, 'v1', 'ownbeside', { user: '4101:4001' });
    const app = await buildSeedableApp({
      env,
      name: appName,
      instances: 2,
      compose: [{
        name: appName,
        description: 'ownership beside an app\'s syncthing',
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
    await installOnNodes(env, app, [LEGACY]);
    await waitForUp(client(LEGACY), appName, 'the legacy node runs the app', { timeout: 300000, interval: 3000 });
    await installOnNodes(env, app, [ARCANE]);
    await waitFor(() => isFolderSynced(client(ARCANE), folder), {
      timeout: 300000, interval: 3000, label: 'the Arcane node has the legacy node\'s data',
    });

    expect((await getFolderConfig(client(LEGACY), folder))?.syncOwnership, 'the legacy node\'s folder carries ownership').to.equal(true);
    expect(await counter(LEGACY, 'syncthing:ownershipWriteRefused'), 'ownership writes refused').to.equal(refusedBefore);
    expect((await appSyncthing(LEGACY)).length, 'the app\'s syncthing still runs').to.be.greaterThan(0);

    const r = await sh(LEGACY, `printf 'beside' > ${data}/beside && chown 4101:4002 ${data}/beside`);
    expect(r.exitCode, `fixture: ${r.output}`).to.equal(0);
    await scanFolder(client(LEGACY), folder);
    await waitFor(async () => {
      const got = await statPath(client(ARCANE), `${data}/beside`);
      return got?.uid === 4101 && got?.gid === 4002;
    }, { timeout: 300000, interval: 3000, label: 'the file reached the Arcane node as 4101:4002' });
  });
});
