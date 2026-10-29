// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { getAppContainerStatus } from '../framework/container.js';
import { electMaster, resetFdm } from '../framework/fdm-control.js';
import {
  waitFor, waitHolding, waitForReconcileActuated, waitForUp, waitForElectionDecisions,
} from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { isDaemonUp, listFolderFiles, getFolderConfig } from '../framework/syncthing-real.js';
import { syncthingSeedIndex } from '../framework/g-app-placement.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A standby whose primary already holds the writable copy announces no intent to
// seed it. The app holds no data anywhere, so no holder outranks another by what
// it holds and the address order alone would name the lowest address - the
// standby. The copy is already held, so there is nothing to seed: the standby is
// never elected, raises no seed mark, and the election never has one to withdraw.
//
// A = the standby, at the lowest address; B = the primary FDM names. The third
// node is a bystander the discovery ring needs.

const A = 0;
const B = 1;
// Folder passes and election cycles on the standby over which it is watched.
const WATCHED_PASSES = 6;
const appDir = (name) => `/mnt/appdata/flux-apps/flux${name}_${name}/appdata`;

describe('a standby beside a writable copy announces no seed', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eseedmark${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const folder = `flux${identifier}`;
  const client = (i) => env.clients[i];
  const isUp = async (i) => {
    const status = await getAppContainerStatus(client(i).container, appName);
    return !!(status && status.status.startsWith('Up'));
  };
  const withdrawn = (i) => client(i).getDecisionCount('syncthing:seedMark', folder, 'withdrawn');
  const folderPasses = (i) => client(i).getDecisionCount('syncthing:folderPass', folder, 'evaluated');
  const electionCycles = async (i) => (await client(i).getTestCounters())?.['masterSlave:cycles'] || 0;

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
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g', instances: 2 });

    await electMaster(appName, client(B).ip);
    const primaryAfter = client(B).getLastEventId();
    await installOnNodes(env, app, [B]);
    await waitForReconcileActuated(client(B), identifier, 'dataCleared', 120000, { afterId: primaryAfter });
    await waitForUp(client(B), appName, 'the primary is running', { timeout: 180000, interval: 3000 });

    const standbyAfter = client(A).getLastEventId();
    await installOnNodes(env, app, [A]);
    await waitForReconcileActuated(client(A), identifier, 'dataCleared', 120000, { afterId: standbyAfter });
    await waitForElectionDecisions(client(A), identifier, 'primaryObserved', 1, { timeout: 120000 });
  });

  after(async function () {
    this.timeout(60000);
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('raises no seed mark on the standby while the primary holds the writable copy', async function () {
    this.timeout(900000);
    expect(syncthingSeedIndex([A, B]), 'fixture: the standby is the lowest address of the holders').to.equal(A);
    const primaryFiles = (await listFolderFiles(client(B), appDir(appName))).split(' ').filter((entry) => entry && !entry.startsWith('.'));
    expect(primaryFiles, 'fixture: the primary holds no data').to.deep.equal([]);
    await waitFor(async () => (await client(B).getPromotedFolders())?.data?.folders?.includes(folder), {
      timeout: 120000, interval: 3000, label: 'the primary holds the writable copy',
    });

    const fromWithdrawn = await withdrawn(A);
    const fromPasses = await folderPasses(A);
    const fromCycles = await electionCycles(A);
    await waitHolding(async () => {
      expect(await withdrawn(A), 'seed marks the standby raised and the election withdrew').to.equal(fromWithdrawn);
      expect(await isUp(A), 'the standby runs the app').to.equal(false);
      expect(await isUp(B), 'the primary stopped running the app').to.equal(true);
      const passes = await folderPasses(A);
      const cycles = await electionCycles(A);
      return passes >= fromPasses + WATCHED_PASSES && cycles >= fromCycles + WATCHED_PASSES;
    }, { timeout: 600000, interval: 2000, label: `${WATCHED_PASSES} folder passes and election cycles on the standby` });

    expect((await getFolderConfig(client(A), folder))?.type, 'the standby\'s folder').to.equal('receiveonly');
  });
});
