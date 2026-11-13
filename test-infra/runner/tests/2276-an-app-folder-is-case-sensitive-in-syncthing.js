/*
 * Every app folder FluxOS owns runs with syncthing's case checks off
 * (caseSensitiveFS), whether FluxOS created it or found it in syncthing with them
 * on, and the app's data goes on reaching the standby after the change.
 *
 * Syncthing's own default leaves the checks on, and a folder syncthing holds with
 * them on is set back to that here through the daemon's API on both holders: the
 * primary, whose folder sends, and the standby, whose folder receives. The
 * monitor's pass then rewrites each, and syncthing restarts the folder on the
 * change. A file the primary writes after both restarts must reach the standby.
 *
 * Real syncthing; run it on both of test-infra/syncthing-versions.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, listAppContainers } from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { followPrimary } from '../framework/fdm-control.js';
import { waitFor } from '../framework/wait.js';
import {
  getFolderConfig, getFolderStatus, isDaemonUp, patchFolderConfig, readPath, scanFolder,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const WRITTEN = 'appdata/written-after-the-restart.txt';

describe('an app folder is case-sensitive in syncthing', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2ecase${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const HOLDERS = [1, 2];
  const client = (i) => env.clients[i];
  let primary;
  let standby;

  const running = async (i) => (await listAppContainers(client(i).container))
    .some((c) => c.name.includes(appName) && c.status?.startsWith('Up'));
  const caseSensitive = async (i) => {
    const config = await getFolderConfig(client(i), folder);
    if (!config) throw new Error(`node ${i} holds no config for ${folder}`);
    return config.caseSensitiveFS;
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c, i) => waitFor(() => isDaemonUp(c), {
      timeout: 180000, interval: 3000, label: `syncthing daemon up on node ${i}`,
    })));

    await followPrimary(appName, { nodes: HOLDERS.map((i) => new URL(client(i).url).host), gNames: [folder] });
    await pushTestApp(appName, 'v1', appName, { user: 1000 });
    await installOnNodes(env, await buildSeedableApp({
      env,
      name: appName,
      instances: HOLDERS.length,
      compose: [{
        name: appName,
        description: 'g: component',
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
    }), HOLDERS);
    await waitFor(async () => (await Promise.all(HOLDERS.map(running))).filter(Boolean).length === 1, {
      timeout: 300000, interval: 3000, label: 'one holder is the primary',
    });
    primary = HOLDERS[(await Promise.all(HOLDERS.map(running))).indexOf(true)];
    standby = HOLDERS.find((i) => i !== primary);

    const standbyPath = (await getFolderConfig(client(standby), folder)).path;
    await waitFor(async () => (await readPath(client(standby), `${standbyPath}/appdata/placed.txt`)) !== null, {
      timeout: 180000, interval: 2000, label: 'the standby holds the primary\'s data',
    });
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('runs the folder FluxOS created with case checks off on every holder', async function () {
    this.timeout(60000);
    expect(await Promise.all(HOLDERS.map(caseSensitive))).to.deep.equal([true, true]);
  });

  it('turns case checks off on a folder syncthing holds with them on, on the primary and the standby', async function () {
    this.timeout(300000);
    const marks = new Map(HOLDERS.map((i) => [i, client(i).getLastEventId()]));
    await Promise.all(HOLDERS.map((i) => patchFolderConfig(client(i), folder, { caseSensitiveFS: false })));
    expect(await Promise.all(HOLDERS.map(caseSensitive)), 'fixture: both holders hold the folder with case checks on').to.deep.equal([false, false]);

    await Promise.all(HOLDERS.map((i) => client(i).waitForEvent('syncthing:passComplete',
      (data) => data.wrote.includes(folder), 120000, { afterId: marks.get(i) })));
    await waitFor(async () => (await Promise.all(HOLDERS.map(caseSensitive))).every((v) => v === true), {
      timeout: 60000, interval: 2000, label: 'both holders hold the folder with case checks off',
    });
  });

  it('delivers a file the primary writes after the folders restarted', async function () {
    this.timeout(300000);
    await waitFor(async () => (await getFolderStatus(client(standby), folder)).state === 'idle', {
      timeout: 120000, interval: 2000, label: 'the standby\'s folder runs again',
    });
    const primaryPath = (await getFolderConfig(client(primary), folder)).path;
    const made = await execInContainer(client(primary).container,
      `echo after > ${primaryPath}/${WRITTEN} && chown 1000:1000 ${primaryPath}/${WRITTEN}`);
    expect(made.exitCode, made.output).to.equal(0);
    await scanFolder(client(primary), folder);

    const standbyPath = (await getFolderConfig(client(standby), folder)).path;
    await waitFor(async () => (await readPath(client(standby), `${standbyPath}/${WRITTEN}`)) !== null, {
      timeout: 120000, interval: 2000, label: 'the file written after the restart on the standby',
    });
  });
});
