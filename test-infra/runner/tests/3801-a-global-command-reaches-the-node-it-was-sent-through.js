/*
 * An owner's command to every instance of an app reaches every instance,
 * including the node it was sent through, when that node cannot reach its own
 * address.
 *
 * A node behind NAT reaches its own public address only if its router hairpins,
 * and most do not. The node the command is sent through is one of the app's
 * locations, so it is a recipient as well as the sender. Here that node drops
 * every packet it sends to its own fleet address on its API port, which is what
 * a router that does not hairpin leaves it with; the other holders reach it as
 * normal. Each test sends one global command through it and waits for the
 * command's effect on all three holders.
 *
 * The app is a plain one, so every holder runs it and acts on each command
 * itself; no election decides which of them may.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { waitFor, waitForOperatorIntent } from '../framework/wait.js';
import { hold, releaseAll, reaches } from '../framework/packet-hold.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const API_PORT = 16127;
// Node 0 is outside the app: every backward arc of the ring wraps onto it.
const HOLDERS = [1, 2, 3];
// The middle of the holders, so it is neither first nor last in the fan-out.
const VIA = 2;

describe('a global command reaches the node it was sent through', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2eglobalvia${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const client = (i) => env.clients[i];
  const marks = () => Object.fromEntries(HOLDERS.map((i) => [i, client(i).getLastEventId()]));

  const globally = async (path) => {
    const { zelidauth } = await authenticate(client(VIA).url, appOwnerKey());
    const res = await client(VIA).getAuthed(path, zelidauth);
    expect(res?.status, `global ${path} through node ${VIA}: ${JSON.stringify(res)}`).to.equal('success');
  };

  // The event `wait` names, on every holder, after the marks taken before the
  // command was sent.
  const onEveryHolder = (from, wait) => Promise.all(HOLDERS.map(async (i) => {
    try {
      return await wait(client(i), { afterId: from[i] });
    } catch (error) {
      throw new Error(`node ${i}${i === VIA ? ' (the node the command was sent through)' : ''}: ${error.message}`);
    }
  }));

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 4 });
    await bootAndPeer(env);

    await pushTestApp(appName, 'v1', 'globalvia');
    const app = await buildSeedableApp({
      env,
      name: appName,
      instances: HOLDERS.length,
      compose: [{
        name: appName,
        description: 'a global command through one of its holders',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
    await installOnNodes(env, app, HOLDERS);

    // The fan-out sends to the locations the node holds, so the node must list
    // every holder, itself included, before a command is sent through it.
    await waitFor(async () => {
      const res = await client(VIA).get(`/apps/location/${appName}?_=${Date.now()}`);
      const listed = (res?.data ?? []).map((row) => String(row.ip).split(':')[0]);
      return HOLDERS.every((i) => listed.includes(client(i).ip));
    }, { timeout: 180000, interval: 3000, label: `node ${VIA} lists every holder of ${appName}` });

    expect(await reaches(client(VIA), client(VIA).ip, API_PORT), `node ${VIA} reaches its own address before the hold`).to.equal(true);
    await hold(client(VIA), { direction: 'out', to: client(VIA).ip, dport: API_PORT });
    expect(await reaches(client(VIA), client(VIA).ip, API_PORT), `node ${VIA} reaches its own address`).to.equal(false);
    expect(await reaches(client(VIA), '127.0.0.1', API_PORT), `node ${VIA} reaches its own API on loopback`).to.equal(true);
    expect(await reaches(client(1), client(VIA).ip, API_PORT), `node 1 reaches node ${VIA}`).to.equal(true);
  });

  after(async function () {
    this.timeout(60000);
    if (env) await releaseAll(client(VIA)).catch(() => {});
    await env?.teardown();
  });

  it('soft redeploys the app on every holder', async function () {
    this.timeout(420000);
    const from = marks();
    await globally(`/apps/redeploy/${appName}/false/true`);
    const redeployed = await onEveryHolder(from, (c, opts) => c.waitForEvent(
      'app:softRedeployed',
      (d) => d.name === appName,
      360000,
      opts,
    ));
    expect(redeployed.map((e) => e.data.outcome), 'each holder\'s outcome').to.deep.equal(HOLDERS.map(() => 'installed'));
  });

  it('restarts the app on every holder', async function () {
    this.timeout(240000);
    const from = marks();
    await globally(`/apps/apprestart/${appName}/true`);
    await onEveryHolder(from, (c, opts) => c.waitForEvent(
      'app:operatorIntent',
      (d) => d.identifier === identifier && d.restartRequested === true,
      180000,
      opts,
    ));
  });

  it('stops the app on every holder', async function () {
    this.timeout(240000);
    const from = marks();
    await globally(`/apps/appstop/${appName}/true`);
    await onEveryHolder(from, (c, opts) => waitForOperatorIntent(c, identifier, true, 180000, opts));
  });

  it('starts the app on every holder', async function () {
    this.timeout(240000);
    const from = marks();
    await globally(`/apps/appstart/${appName}/true`);
    await onEveryHolder(from, (c, opts) => waitForOperatorIntent(c, identifier, false, 180000, opts));
  });

  it('removes the app from every holder', async function () {
    this.timeout(300000);
    const from = marks();
    await globally(`/apps/appremove/${appName}/false/true`);
    await onEveryHolder(from, (c, opts) => c.waitForEvent('app:removed', (d) => d.name === appName, 240000, opts));
  });
});
