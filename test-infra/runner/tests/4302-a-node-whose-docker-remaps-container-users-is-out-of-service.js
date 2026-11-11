/*
 * A node whose Docker remaps container users (userns-remap) is out of service: after
 * the Docker restart that takes the setting up, nothing is reconciled until FluxOS has
 * checked the Docker that came back; the check puts the node in DOS; the node gives its
 * apps up; and a Docker restart without the setting returns it to service.
 *
 * Docker reads the setting only when it starts, and its restart drops FluxOS's event
 * stream; the stream's resubscribe is where the restarted Docker is checked. Switching
 * remapping on also moves Docker to another storage root, so the app's container is
 * missing from the Docker that comes back. The resubscribe is held while an owner's
 * restart asks for a reconcile: a reconciler acting then would rebuild the container
 * under the remapping Docker.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { setDockerUsernsRemap } from '../framework/container.js';
import {
  waitFor, waitForUp, waitForAppRemoved, assertNoEvent,
} from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { appOwnerKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const SUBJECT = 2;
const RESUBSCRIBE = 'dockerEvents:beforeResubscribe';
const remapVerdict = (d) => d.dosState >= 100 && /userns-remap/.test(d.dosMessage ?? '');

describe('a node whose Docker remaps container users is out of service', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eremap${Date.now()}`;
  const identifier = `${appName}_${appName}`;
  const actuated = (d) => d.identifier === identifier && ['recreated', 'started'].includes(d.action);
  let beforeRemap;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 5 });
    await bootAndPeer(env);
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      env,
      name: appName,
      compose: [{
        name: appName,
        description: 'test container',
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
    await installOnNodes(env, app, [SUBJECT]);
    await waitForUp(env.clients[SUBJECT], appName, 'the app runs before Docker remaps');
  });

  after(async function () {
    this.timeout(120000);
    if (env) {
      await env.clients[SUBJECT].releaseCheckpoint(RESUBSCRIBE, 'docker').catch(() => {});
      await setDockerUsernsRemap(env.clients[SUBJECT].container, false).catch(() => {});
    }
    await env?.teardown();
  });

  it('reconciles nothing under a restarted Docker it has not yet checked', async function () {
    this.timeout(240000);
    const client = env.clients[SUBJECT];
    const auth = await authenticate(client.url, appOwnerKey());
    await client.holdCheckpoint(RESUBSCRIBE, 'docker');
    beforeRemap = client.getLastEventId();
    await setDockerUsernsRemap(client.container, true);
    await client.waitForEvent('checkpoint:held', (d) => d.name === RESUBSCRIBE && d.key === 'docker', 60000, { afterId: beforeRemap });

    // The canary: a pass for the component ran, deferred or acting.
    const deferredBefore = await client.getDecisionCount('reconciler:deferred', identifier, 'dockerUnwatched');
    const passRan = async () => (await client.getDecisionCount('reconciler:deferred', identifier, 'dockerUnwatched')) > deferredBefore
      || client.getEventBuffer().some((e) => e.event === 'reconciler:actuated' && e.id > beforeRemap && e.data?.identifier === identifier);
    client.getAuthed(`/apps/apprestart/${appName}`, auth.zelidauth).catch(() => {});
    await waitFor(passRan, { timeout: 60000, interval: 1000, label: "the owner's restart reached the reconciler" });
    await assertNoEvent(client, 'reconciler:actuated', actuated, 20000, { afterId: beforeRemap });
  });

  it('takes the node out of service once it checks the restarted Docker', async function () {
    this.timeout(180000);
    const client = env.clients[SUBJECT];
    await client.releaseCheckpoint(RESUBSCRIBE, 'docker');
    await client.waitForEvent('dos:changed', remapVerdict, 120000, { afterId: beforeRemap });
  });

  it('gives its apps up, and rebuilds and starts nothing under that Docker', async function () {
    this.timeout(240000);
    const client = env.clients[SUBJECT];
    await waitForAppRemoved(client, appName, 180000, { afterId: beforeRemap });
    await assertNoEvent(client, 'reconciler:actuated', actuated, 1000, { afterId: beforeRemap });
  });

  it('returns to service once Docker restarts without remapping', async function () {
    this.timeout(180000);
    const client = env.clients[SUBJECT];
    const held = await client.getDOSState();
    expect(held.data?.dosMessage ?? '', 'the node is out of service for remapping before Docker restarts without it').to.match(/userns-remap/);
    const beforeRestore = client.getLastEventId();
    await setDockerUsernsRemap(client.container, false);
    await client.waitForEvent('dos:changed', (d) => d.dosState < 100 && !/userns-remap/.test(d.dosMessage ?? ''), 120000, { afterId: beforeRestore });
  });
});
