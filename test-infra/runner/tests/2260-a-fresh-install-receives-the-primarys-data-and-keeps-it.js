// weight: heavy
import {
  describe, it, before,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { execInContainer, getAppContainerStatus } from '../framework/container.js';
import { electMaster, resetFdm } from '../framework/fdm-control.js';
import {
  waitFor, waitHolding, waitForFolderTakenOn, waitForUp,
} from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { isDaemonUp, listFolderFiles, getFolderConfig } from '../framework/syncthing-real.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

// A node installing a g: app afresh starts on a new, empty volume. Its folder is
// created receiving and unpaused, the primary's file arrives, and nothing on the
// node deletes it afterwards. The app stays stopped on the new holder: the
// primary runs it.
//
// A = the node installing afresh; B = the primary, holding a file. The third node
// is a bystander the discovery ring needs.

const A = 0;
const B = 1;
// How long the file is watched after it arrived.
const KEPT_MS = 60000;
const FILE = 'held-by-the-primary.txt';
const appDir = (name) => `/mnt/appdata/flux-apps/flux${name}_${name}/appdata`;

describe('a fresh install receives the primary\'s data and keeps it', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2efreshkeeps${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const folder = `flux${identifier}`;
  let app;
  const client = (i) => env.clients[i];
  const filesOn = async (i) => (await listFolderFiles(client(i), appDir(appName))).split(' ').filter((entry) => entry && !entry.startsWith('.'));

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
    await resetFdm();
    await pushImage(appName, 'v1');
    app = await buildSeedableSyncthingApp({ name: appName, mode: 'g', instances: 2 });

    await electMaster(appName, client(B).ip);
    const primaryAfter = client(B).getLastEventId();
    await installOnNodes(env, app, [B]);
    await waitForFolderTakenOn(client(B), identifier, 120000, { afterId: primaryAfter });
    await waitForUp(client(B), appName, 'the primary is running', { timeout: 180000, interval: 3000 });
    await waitFor(async () => (await client(B).getPromotedFolders())?.data?.folders?.includes(folder), {
      timeout: 120000, interval: 3000, label: 'the primary holds the writable copy',
    });
    await execInContainer(client(B).container, `echo held-by-the-primary > ${appDir(appName)}/${FILE}`);
  });

  afterTeardown(async function () {
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('creates the folder receiving and unpaused, and takes the primary\'s file', async function () {
    this.timeout(600000);
    expect(await filesOn(B), 'fixture: the primary holds the file').to.include(FILE);

    const from = client(A).getLastEventId();
    await installOnNodes(env, app, [A]);
    await waitForFolderTakenOn(client(A), identifier, 120000, { afterId: from });

    await waitFor(async () => {
      const config = await getFolderConfig(client(A), folder);
      return config?.type === 'receiveonly' && config.paused === false;
    }, { timeout: 120000, interval: 2000, label: 'the new holder\'s folder receiving and unpaused' });
    await waitFor(async () => (await filesOn(A)).includes(FILE), {
      timeout: 180000, interval: 2000, label: 'the primary\'s file arrived',
    });
  });

  it('keeps the file, with the app stopped on the new holder', async function () {
    this.timeout(300000);
    const arrivedAt = Date.now();
    await waitHolding(async () => {
      expect(await filesOn(A), 'the file on the node that installed afresh').to.include(FILE);
      const status = await getAppContainerStatus(client(A).container, appName);
      expect(status?.status ?? '', 'the app on the new holder').to.not.match(/^Up/);
      return Date.now() - arrivedAt >= KEPT_MS;
    }, { timeout: KEPT_MS + 60000, interval: 5000, label: `the file kept for ${KEPT_MS / 1000}s` });
  });
});
