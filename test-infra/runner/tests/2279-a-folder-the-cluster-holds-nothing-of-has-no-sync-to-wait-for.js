/*
 * A folder the cluster's index holds nothing of has no sync to wait for: every copy of an
 * r: app that never wrote a file starts, and a surplus copy of one can leave.
 *
 * Real syncthing, because the property is what a daemon reports for an empty folder, and
 * that differs by release: before v2.1.2 a directory counts as 128 bytes. The fleet's
 * release is whichever the images were built with; run it on both of
 * test-infra/syncthing-versions.
 *
 * The app that writes a file is the control: the same fleet, the same path to starting,
 * through a sync.
 *
 * Not here: a copy holding data the index does not show, which needs a node stopped
 * between its volume and its first monitor pass. Those are unit-tested.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { listAppContainers } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import { isDaemonUp, getFolderConfig, getFolderStatus } from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

describe('a folder the cluster holds nothing of has no sync to wait for', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const stamp = Date.now();
  const emptyApp = `e2eemptyr${stamp}`;
  const dataApp = `e2edatar${stamp}`;
  const spareApp = `e2esparer${stamp}`;
  const HOLDERS = [0, 1, 2];

  const folderOf = (name) => `flux${name}_${name}`;
  const running = async (i, name) => (await listAppContainers(env.clients[i].container))
    .some((c) => c.name.includes(name) && c.status?.startsWith('Up'));
  const allRunning = async (name) => (await Promise.all(HOLDERS.map((i) => running(i, name)))).every(Boolean);
  const compose = (name, environmentParameters = []) => [{
    name,
    description: 'r: component',
    repotag: `${REGISTRY_REPO_HOST}/${name}:v1`,
    ports: [],
    domains: [''],
    environmentParameters,
    commands: [],
    containerPorts: [80],
    containerData: 'r:/appdata',
    cpu: 0.1,
    ram: 100,
    hdd: 1,
    repoauth: '',
  }];

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 4,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));
    await Promise.all([emptyApp, dataApp, spareApp].map((name) => pushTestApp(name, 'v1', name, { user: 1000 })));
    await installOnNodes(env, await buildSeedableApp({
      env, name: dataApp, instances: 3, compose: compose(dataApp, ['WRITE_FILE=/appdata/placed.txt', 'WRITE_CONTENT=placed']),
    }), HOLDERS);
    await installOnNodes(env, await buildSeedableApp({
      env, name: emptyApp, instances: 3, compose: compose(emptyApp),
    }), HOLDERS);
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('every copy of an app with a file starts, through a sync', async function () {
    this.timeout(300000);
    await waitFor(() => allRunning(dataApp), { timeout: 240000, interval: 5000, label: 'three copies of the control up' });
  });

  it('every copy of an app that wrote nothing starts', async function () {
    this.timeout(300000);
    await waitFor(() => allRunning(emptyApp), { timeout: 240000, interval: 5000, label: 'three copies of the empty app up' });
    const folders = await Promise.all(HOLDERS.map((i) => getFolderConfig(env.clients[i], folderOf(emptyApp))));
    expect(folders.map((folder) => folder.type)).to.deep.equal(['sendreceive', 'sendreceive', 'sendreceive']);
    const statuses = await Promise.all(HOLDERS.map((i) => getFolderStatus(env.clients[i], folderOf(emptyApp))));
    expect(statuses.map((status) => status.globalFiles), 'the app wrote a file').to.deep.equal([0, 0, 0]);
  });

  it('a surplus copy of an app that wrote nothing leaves', async function () {
    this.timeout(420000);
    await installOnNodes(env, await buildSeedableApp({
      env, name: spareApp, instances: 2, compose: compose(spareApp),
    }), HOLDERS);
    await waitFor(async () => (await env.clients[3].getAppLocations(spareApp)).data?.length === 3, {
      timeout: 120000, interval: 3000, label: 'three locations for an app wanting two',
    });
    await waitFor(async () => (await env.clients[3].getAppLocations(spareApp)).data?.length === 2, {
      timeout: 300000, interval: 5000, label: 'the surplus copy gone',
    });
  });
});
