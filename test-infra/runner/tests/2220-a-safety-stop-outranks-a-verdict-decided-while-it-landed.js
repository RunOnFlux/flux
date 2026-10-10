import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { execInContainer, getAppContainerStatus, restartFluxos } from '../framework/container.js';
import { resetFdm, electMaster } from '../framework/fdm-control.js';
import {
  waitFor, waitForReconcileActuated, waitForReconcilerDesiredChanged, waitForElectionDecisions, electionDecisionCount,
  assertNoEvent,
} from '../framework/wait.js';
import { setSynced, resetSyncState, injectSyncthingEvent } from '../framework/syncthing-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes, seedSyncScopedData } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A decider that writes a component's controller opinion while another is deciding
// across awaits decided last, and its decision stands. After a FluxOS restart the
// election adopts 'running' for the primary already running here, reading the
// operator lock and docker before it writes; the mount-safety block writing
// 'stopped' for that component in the meantime must not be overwritten by it.
//
// The adoption is held at its checkpoint, after it has found no opinion recorded
// and before those reads, while the volume under the component goes away and the
// mount-safety block holds the container.

const subnet = getSubnetConfig();
const BEFORE_ADOPT = 'reconciler:beforeAdopt';

const appId = (name) => `flux${name}_${name}`;
const appDir = (name) => `/mnt/appdata/flux-apps/${appId(name)}`;
const volFile = (name) => `/mnt/appdata/${appId(name)}FLUXFSVOL`;

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('a safety stop outranks a verdict decided while it landed', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let holders;
  const appName = `e2eoutrank${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const folder = appId(appName);

  const runningFlags = async () => Promise.all(holders.map((i) => isUp(env.clients[i], appName)));

  before(async function () {
    this.timeout(360000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await resetFdm();
    await resetSyncState();
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });

    const installAfters = [0, 1].map((i) => env.clients[i].getLastEventId());
    holders = await installOnNodes(env, app, [0, 1]);
    await Promise.all(holders.map(async (i, k) => {
      await waitForReconcileActuated(env.clients[i], identifier, 'dataCleared', 60000, { afterId: installAfters[k] });
      await seedSyncScopedData(env, appName, i);
    }));
    await Promise.all(holders.map((i) => setSynced({ ip: subnet.nodeIp(i + 1), folder })));

    await waitFor(async () => (await runningFlags()).filter(Boolean).length === 1, {
      timeout: 60000, interval: 2000, label: 'the election settles on one holder',
    });
  });

  after(async function () {
    this.timeout(30000);
    await resetFdm().catch(() => {});
    await env?.teardown();
  });

  it('keeps the mount-safety stop written while the primary\'s adoption read the lock and docker', async function () {
    this.timeout(300000);
    const primary = holders[(await runningFlags()).indexOf(true)];
    const client = env.clients[primary];
    const ip = subnet.nodeIp(primary + 1);

    // The adoption is the election's verdict for the primary FDM names.
    const observedBefore = await electionDecisionCount(client, identifier, 'primaryObserved');
    await electMaster(appName, ip);
    await waitForElectionDecisions(client, identifier, 'primaryObserved', 1, { from: observedBefore, timeout: 45000 });

    // The election runs only once the restarted node has synced its state, well after
    // its API answers, so the hold is in place before the adoption is reached.
    const beforeRestart = client.getLastEventId();
    await restartFluxos(client.container, { readyTimeoutMs: 45000 });
    await client.holdCheckpoint(BEFORE_ADOPT, identifier);
    await client.waitForEvent('checkpoint:held', (d) => d.name === BEFORE_ADOPT && d.key === identifier, 180000, { afterId: beforeRestart });

    // The volume goes away under the running primary: unmounted and its image
    // removed, so it cannot be repaired, and syncthing raises FolderErrors for it.
    const beforeBreak = client.getLastEventId();
    const broken = await execInContainer(client.container,
      `umount -l ${appDir(appName)} && chattr -i ${appDir(appName)} && rm -f ${volFile(appName)}`);
    expect(broken.exitCode, `could not break the volume: ${broken.output}`).to.equal(0);
    await injectSyncthingEvent({ ip, type: 'FolderErrors', data: { folder, errors: [{ error: 'folder marker missing' }] } });
    await waitForReconcilerDesiredChanged(client, identifier, 'stopped', 120000, { afterId: beforeBreak });

    const beforeRelease = client.getLastEventId();
    await client.releaseCheckpoint(BEFORE_ADOPT, identifier);

    await assertNoEvent(client, 'reconciler:desiredChanged', (d) => d.identifier === identifier && d.state === 'running', 20000, { afterId: beforeRelease });
    await waitFor(async () => !(await isUp(client, appName)), {
      timeout: 60000, interval: 2000, label: 'the primary over the broken volume is held stopped',
    });
  });
});
