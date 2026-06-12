import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getAppContainerStatus, restartDockerd } from '../framework/container.js';
import { buildSeedableEnterpriseApp } from '../framework/seed-helper.js';
import { pushImage } from '../framework/registry-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitForUp } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// B2 end-to-end: enterprise apps (spec stored encrypted - version 8, compose
// empty, AES blob) must be covered by the reconnect sweep exactly like plain
// apps. The sweep decrypts leniently through the normal benchd path (the daemon
// stub hands back the known AES key); a dockerd restart that leaves the
// container stopped must end with the reconciler starting it again.

async function isUp(client, appName) {
  const status = await getAppContainerStatus(client.container, appName);
  return !!(status && status.status.startsWith('Up'));
}

describe('reconnect sweep covers enterprise apps (encrypted at rest)', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2eent${Date.now()}`;
  let identifier;

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await pushImage(appName, 'v1');
    const app = await buildSeedableEnterpriseApp({ name: appName });
    await installOnNodes(env, app, [0]);
    identifier = `${appName}_${appName}`;
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('recovers the enterprise app after a dockerd restart via the reconnect sweep', async function () {
    this.timeout(180000);
    const client = env.clients[0];
    await waitForUp(client, appName, 'enterprise app running before dockerd restart');

    const afterId = client.getLastEventId();
    await restartDockerd(client.container);

    // the reconnect sweep enumerates the enterprise app (decrypting the spec)
    // and the reconciler brings the container back
    await client.waitForEvent('reconciler:actuated', (d) => d.identifier === identifier && d.action === 'started', 120000, { afterId });
    await waitForUp(client, appName, 'enterprise app running again after sweep');
    expect(await isUp(client, appName)).to.equal(true);
  });
});
