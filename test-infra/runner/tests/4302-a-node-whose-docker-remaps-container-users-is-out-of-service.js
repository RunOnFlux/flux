/*
 * A node whose Docker remaps container users (userns-remap) is out of service: the
 * Docker restart that takes the setting up puts the node in DOS, nothing is rebuilt or
 * started under the remapping Docker, the node gives its apps up, and a Docker restart
 * without the setting returns it to service.
 *
 * Docker reads the setting only when it starts, and its restart drops FluxOS's event
 * stream; the reconnect is where the setting is first seen. Switching remapping on also
 * moves Docker to another storage root, so the app's container is missing from the
 * Docker that comes back: a reconciler acting before the check would rebuild it there.
 */
import { describe, it, before, after } from 'mocha';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { setDockerUsernsRemap } from '../framework/container.js';
import {
  waitForUp, waitForAppRemoved, assertNoEvent,
} from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const SUBJECT = 2;
const remapVerdict = (d) => d.dosState >= 100 && /userns-remap/.test(d.dosMessage ?? '');

describe('a node whose Docker remaps container users is out of service', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eremap${Date.now()}`;
  const identifier = `${appName}_${appName}`;
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
    if (env) await setDockerUsernsRemap(env.clients[SUBJECT].container, false).catch(() => {});
    await env?.teardown();
  });

  it('takes the node out of service once Docker restarts remapping container users', async function () {
    this.timeout(180000);
    const client = env.clients[SUBJECT];
    beforeRemap = client.getLastEventId();
    await setDockerUsernsRemap(client.container, true);
    await client.waitForEvent('dos:changed', remapVerdict, 120000, { afterId: beforeRemap });
  });

  it('gives its apps up, and rebuilds and starts nothing under that Docker', async function () {
    this.timeout(240000);
    const client = env.clients[SUBJECT];
    await waitForAppRemoved(client, appName, 180000, { afterId: beforeRemap });
    await assertNoEvent(client, 'reconciler:actuated', (d) => d.identifier === identifier && ['recreated', 'started'].includes(d.action), 1000, { afterId: beforeRemap });
  });

  it('returns to service once Docker restarts without remapping', async function () {
    this.timeout(180000);
    const client = env.clients[SUBJECT];
    const beforeRestore = client.getLastEventId();
    await setDockerUsernsRemap(client.container, false);
    await client.waitForEvent('dos:changed', (d) => d.dosState < 100 && !/userns-remap/.test(d.dosMessage ?? ''), 120000, { afterId: beforeRestore });
  });
});
