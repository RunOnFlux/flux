/*
 * A running copy whose restore record cannot be read is left as it is: its folder
 * keeps sending, the app's own writes stay and reach the other holders, its
 * container keeps running and the copy stays ready, in every sync mode, through every folder pass the read
 * fails on. A record nobody read decides nothing; what it guards is still refused.
 *
 * Three holders on real syncthing daemons and a fourth node that keeps the ring whole.
 * The record is unreadable on one node alone: every find on its runtime-state
 * collection fails, as a call that ran out of time does, while every other read and
 * every other node goes on. The g: case reads the node that runs the component.
 *
 * The running copy holds a write the other holders do not have yet - its syncthing
 * reaches none of them while the record is unreadable - so no peer is synced and
 * nothing heals the folder: a record read as held would turn it and revert the write.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { isAppContainerRunning, blockTraffic, unblockTraffic } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, waitHolding } from '../framework/wait.js';
import {
  isDaemonUp, isFolderSynced, getFolderConfig, dropConnections, scanFolder, holdsValidVersion,
} from '../framework/syncthing-real.js';
import { failCommands } from '../framework/mongo-control.js';
import { ORIGINAL, writeAppdata, readAppdata } from '../framework/restore-fixture.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

// folder passes each case holds through with the record unreadable
const PASSES = 3;
const SYNCTHING_PORT = 16127 + 2;

describe('a restore record that cannot be read changes no running copy', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const HOLDERS = [1, 2, 3];
  const client = (i) => env.clients[i];

  const appOf = (appName, mode) => ({
    appName, mode, identifier: `${appName}_${appName}`, folder: `flux${appName}_${appName}`,
  });
  const G = appOf(`e2egunread${ts}`, 'g');
  const R = appOf(`e2erunread${ts}`, 'r');
  const S = appOf(`e2esunread${ts}`, 's');

  const sending = async (i, app) => {
    const config = await getFolderConfig(client(i), app.folder);
    return config?.type === 'sendreceive' && config?.paused !== true;
  };
  const isUp = (i, app) => isAppContainerRunning(client(i).container, app.appName);
  const holdsFiles = async (i, app, files) => JSON.stringify(await readAppdata(client(i), app.appName, app.appName, Object.keys(files))) === JSON.stringify(files);
  const stoppedBeingReady = (i, app, afterId) => client(i).getEventBuffer()
    .filter((e) => e.id > afterId && e.event === 'syncthing:folderNotReady' && e.data?.folder === app.folder)
    .map((e) => e.id);
  const unknownPasses = (i, app) => client(i).getDecisionCount('syncthing:restoreUnfinished', app.folder, 'unknown');
  const runners = async (app) => {
    const running = await Promise.all(HOLDERS.map((i) => isUp(i, app)));
    return HOLDERS.filter((_, k) => running[k]);
  };

  async function place(app) {
    await pushImage(app.appName, 'v1');
    const spec = await buildSeedableSyncthingApp({ name: app.appName, mode: app.mode, env, instances: HOLDERS.length });
    await installOnNodes(env, spec, HOLDERS);
    // a g: component runs on one holder; an r: or s: one on each
    const runs = app.mode === 'g' ? 1 : HOLDERS.length;
    await waitFor(async () => (await runners(app)).length === runs, {
      timeout: 300000, interval: 3000, label: `${app.appName} runs on ${runs} holder(s)`,
    });
    const [writer] = await runners(app);
    await waitFor(() => sending(writer, app), {
      timeout: 300000, interval: 3000, label: `node ${writer}'s ${app.appName} folder sends`,
    });
    await writeAppdata(client(writer), app.appName, app.appName, ORIGINAL);
    await Promise.all(HOLDERS.map((i) => waitFor(async () => (await isFolderSynced(client(i), app.folder)) && holdsFiles(i, app, ORIGINAL), {
      timeout: 300000, interval: 3000, label: `node ${i} holds the ${app.appName} data`,
    })));
  }

  // The running copy on node i, cut off from the other holders, writes a file of its
  // own, then its record cannot be read for PASSES folder passes: through every poll
  // its folder sends, the file is there and the container runs. Once the record
  // reads again and the holders reach each other, the file reaches every one of them.
  async function keepsItsCopyThroughAnUnreadableRecord(i, app) {
    const others = HOLDERS.filter((h) => h !== i);
    const otherIps = others.map((h) => client(h).ip);
    const file = `written-${app.mode}.txt`;
    const written = { [file]: `written-${ts}` };
    let failed = 0;
    await blockTraffic(client(i).container, otherIps, SYNCTHING_PORT);
    try {
      await dropConnections(client(i), others.map(client));
      await writeAppdata(client(i), app.appName, app.appName, written);
      await scanFolder(client(i), app.folder);
      await waitFor(() => holdsValidVersion(client(i), app.folder, `appdata/${file}`), {
        timeout: 120000, interval: 2000, label: `node ${i}'s index holds ${file}`,
      });
      const mark = client(i).getLastEventId();
      const from = await unknownPasses(i, app);
      const release = await failCommands(i + 1, 'localzelapps', 'zelappsruntimestate', { commands: ['find'] });
      try {
        await waitHolding(async () => {
          expect(stoppedBeingReady(i, app, mark), `node ${i}'s copy stopped being ready`).to.deep.equal([]);
          expect(await sending(i, app), `node ${i}'s folder stopped sending`).to.equal(true);
          expect(await holdsFiles(i, app, written), `node ${i} lost the file its app wrote`).to.equal(true);
          expect(await isUp(i, app), `node ${i} stopped its component`).to.equal(true);
          return (await unknownPasses(i, app)) >= from + PASSES;
        }, { timeout: 600000, interval: 2000, label: `${PASSES} folder passes of ${app.appName} on node ${i} with its record unreadable` });
      } finally {
        failed = await release();
      }
    } finally {
      await unblockTraffic(client(i).container, otherIps, SYNCTHING_PORT);
    }
    expect(failed, 'fixture: no read of the record failed').to.be.above(0);
    await Promise.all(HOLDERS.filter((h) => h !== i).map((h) => waitFor(() => holdsFiles(h, app, written), {
      timeout: 300000, interval: 3000, label: `node ${h} holds what node ${i} wrote`,
    })));
  }

  before(async function () {
    this.timeout(1800000);
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
    await place(G);
    await place(R);
    await place(S);
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('keeps a running g: copy sending, its writes and its container, while its record cannot be read', async function () {
    this.timeout(1200000);
    const [runner] = await runners(G);
    await keepsItsCopyThroughAnUnreadableRecord(runner, G);
  });

  it('keeps a running r: copy sending, its writes and its container, while its record cannot be read', async function () {
    this.timeout(1200000);
    await keepsItsCopyThroughAnUnreadableRecord(HOLDERS[1], R);
  });

  it('keeps a running s: copy sending, its writes and its container, while its record cannot be read', async function () {
    this.timeout(1200000);
    await keepsItsCopyThroughAnUnreadableRecord(HOLDERS[1], S);
  });
});
