/*
 * A device one node drops from a folder and adds back, while the other node goes on
 * sharing the folder with it, receives what the folder gained in between.
 *
 * The primary keeps running and sending. Its calls to the standby's API are answered
 * by another node, and the standby's calls to the primary's API are refused, so the
 * primary withholds the standby's device while the standby, which cannot reach the
 * primary to judge it, keeps the device it has configured. A file the primary writes
 * then is in its index while the standby is out of the folder. Both faults lifted, the
 * primary configures the standby again, and only the primary's side has changed.
 * Before syncthing v2.1.2 the primary keeps the index sequence it had reached for the
 * standby across the drop, and that file never reaches the standby unless the two
 * reconnect; from v2.1.2 the exchange starts afresh by itself.
 *
 * Identity verdicts and introductions are held for 5 s, so each fault is noticed, and
 * each lifted, within a pass or two.
 *
 * Real syncthing; run it on both of test-infra/syncthing-versions.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  blockPeerAccess, unblockPeerAccess, execInContainer, listAppContainers, redirectOutbound, clearOutboundRedirect,
} from '../framework/container.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { followPrimary } from '../framework/fdm-control.js';
import { waitFor } from '../framework/wait.js';
import {
  getDeviceId, getFolderConfig, getFolderStatus, getVersion, isDaemonUp, readPath, scanFolder,
} from '../framework/syncthing-real.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const API_PORT = 16127;
const IDENTITY_TTL_MS = 5000;
const WRITTEN = 'appdata/written-while-out.txt';

describe('a device added back to a folder on one side gets what it missed', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2ereadd${Date.now()}`;
  const folder = `flux${appName}_${appName}`;
  const HOLDERS = [1, 2];
  const BYSTANDER = 0;
  const client = (i) => env.clients[i];
  let primary;
  let standby;
  let primaryDevice;
  let standbyDevice;
  let releaseAtLeast212;

  const running = async (i) => (await listAppContainers(client(i).container))
    .some((c) => c.name.includes(appName) && c.status?.startsWith('Up'));
  const sharesWith = async (i, device) => {
    const config = await getFolderConfig(client(i), folder);
    if (!Array.isArray(config?.devices)) throw new Error(`node ${i} holds no config for ${folder}`);
    return config.devices.some(({ deviceID }) => deviceID === device);
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          peerIdentityVerifiedTtlMs: IDENTITY_TTL_MS,
          peerIdentityMisroutedTtlMs: IDENTITY_TTL_MS,
          peerIdentityUnreachableTtlMs: IDENTITY_TTL_MS,
          peerIdentityIntroductionTtlMs: IDENTITY_TTL_MS,
        },
      },
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
    primaryDevice = await getDeviceId(client(primary));
    standbyDevice = await getDeviceId(client(standby));
    const [, major, minor, patch] = /v?(\d+)\.(\d+)\.(\d+)/.exec(await getVersion(client(primary))).map(Number);
    releaseAtLeast212 = major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 2)));

    const standbyPath = (await getFolderConfig(client(standby), folder)).path;
    await waitFor(async () => (await readPath(client(standby), `${standbyPath}/appdata/placed.txt`)) !== null, {
      timeout: 180000, interval: 2000, label: 'the standby holds the primary\'s data',
    });
    // syncthing 2.0.15 scans a directory a pull wrote into as a local change, which the
    // standby reverts and announces. Settled here, so the standby sends nothing while
    // the primary's side changes.
    await scanFolder(client(standby), folder);
    await waitFor(async () => {
      const status = await getFolderStatus(client(standby), folder);
      return status.receiveOnlyChangedFiles === 0 && status.receiveOnlyChangedDirectories === 0 && status.state === 'idle';
    }, { timeout: 120000, interval: 2000, label: 'the standby holds no local changes' });
    expect(await sharesWith(primary, standbyDevice), 'fixture: the primary shares the folder with the standby').to.equal(true);
    expect(await sharesWith(standby, primaryDevice), 'fixture: the standby shares the folder with the primary').to.equal(true);
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('receives a file the primary wrote while it had dropped the standby\'s device', async function () {
    this.timeout(600000);
    const { container } = client(primary);
    const blocked = await blockPeerAccess(container, [client(standby).ip], API_PORT);
    const redirect = await redirectOutbound(container, {
      toIps: [client(standby).ip], ports: String(API_PORT), landsOn: client(BYSTANDER).ip, resetOpen: true,
    });
    let lifted = false;
    const lift = async () => {
      lifted = true;
      await clearOutboundRedirect(container, redirect);
      await unblockPeerAccess(container, blocked, API_PORT);
    };
    try {
      await waitFor(async () => !(await sharesWith(primary, standbyDevice)), {
        timeout: 180000, interval: 2000, label: 'the primary withholds the standby\'s device',
      });
      expect(await sharesWith(standby, primaryDevice), 'fixture: the standby still shares the folder with the primary').to.equal(true);

      const primaryPath = (await getFolderConfig(client(primary), folder)).path;
      const made = await execInContainer(container, `echo missed > ${primaryPath}/${WRITTEN} && chown 1000:1000 ${primaryPath}/${WRITTEN}`);
      expect(made.exitCode, made.output).to.equal(0);
      await scanFolder(client(primary), folder);
      expect(await sharesWith(primary, standbyDevice), 'fixture: the standby still out of the folder once the file is indexed').to.equal(false);

      const mark = client(primary).getLastEventId();
      await lift();
      await waitFor(() => sharesWith(primary, standbyDevice), {
        timeout: 180000, interval: 2000, label: 'the primary shares the folder with the standby again',
      });
      expect(await sharesWith(standby, primaryDevice), 'fixture: the standby kept the primary throughout').to.equal(true);

      const standbyPath = (await getFolderConfig(client(standby), folder)).path;
      await waitFor(async () => (await readPath(client(standby), `${standbyPath}/${WRITTEN}`)) !== null, {
        timeout: 120000, interval: 2000, label: 'the file written while the device was out on the standby',
      });

      const reconnected = client(primary).getEventBuffer().filter((entry) => entry.id > mark
        && entry.event === 'syncthing:deviceReconnected' && entry.data.device === standbyDevice);
      if (releaseAtLeast212) {
        expect(reconnected, 'a reconnect on a release that needs none').to.deep.equal([]);
      } else {
        expect(reconnected.map((entry) => entry.data.folders), 'the standby reconnected for the folder').to.deep.equal([[folder]]);
      }
    } finally {
      if (!lifted) await lift();
    }
  });
});
