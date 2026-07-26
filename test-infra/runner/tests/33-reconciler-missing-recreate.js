import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { getAppContainerStatus, killAppContainer } from '../framework/container.js';
import { waitFor, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A vanished container (no Docker event fires for absence) is recreated by the
// reconciler when Docker is reachable. A registry that cannot be reached does not
// stop that: the layers are already on disk, so the rebuild rides the outage out on
// the local image rather than leaving the customer down or destroying the app.

async function waitForUp(client, appName, label) {
  await waitFor(async () => {
    const status = await getAppContainerStatus(client.container, appName);
    return status && status.status.startsWith('Up');
  }, { timeout: 60000, interval: 2000, label });
}

describe('reconciler recreates a missing container', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let idx;
  const appName = `e2emissing${Date.now()}`;
  const identifier = `${appName}_${appName}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    ({ index: idx } = await seedSimpleApp(env, appName));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('recreates a container that was removed out from under it', async function () {
    this.timeout(150000);
    const client = env.clients[idx];
    await waitForUp(client, appName, 'running before removal');

    const afterId = client.getLastEventId();
    await killAppContainer(client.container, appName); // docker rm -f -> gone

    // docker is reachable, so exists:false is a genuine miss -> recreate
    await waitForReconcileActuated(client, identifier, 'recreated', 90000, { afterId });
    await waitForUp(client, appName, 'recreated and running again');
  });

  it('keeps the app down - not deleted, not run stale - when the registry answers with a verdict', async function () {
    this.timeout(300000);
    const client = env.clients[idx];
    await waitForUp(client, appName, 'running before the tag is re-pushed');

    // The mutable tag is re-pushed claiming layers over the network's size cap -
    // the same bytes, an inflated manifest. The registry is UP and answering:
    // this is a verdict ABOUT THE IMAGE, not a reachability problem, so the
    // rebuild must neither ride it out on the local copy (that would run a
    // spec-violating image the network just rejected) nor delete the app and
    // its data (the image was legal when it installed; the owner can fix the
    // tag). Down-with-backoff is the only correct state.
    await pushImage(appName, 'v1', 'v1', { layerSizeOverride: 6 * 1024 * 1024 * 1024 });

    const afterId = client.getLastEventId();
    await killAppContainer(client.container, appName);

    await waitForReconcileActuated(client, identifier, 'recreateFailedKept', 120000, { afterId });
    const status = await getAppContainerStatus(client.container, appName, { all: true });
    expect(
      !status || !status.status.startsWith('Up'),
      'ran the stale local image despite a definitive registry verdict',
    ).to.equal(true);

    // restore the honest tag: the keep path retries on the backoff ladder, so
    // the app must come back with no operator action at all
    await pushImage(appName, 'v1', 'v1');
    await waitForReconcileActuated(client, identifier, 'recreated', 180000, { afterId: client.getLastEventId() });
    await waitForUp(client, appName, 'recovered once the tag was honest again');
  });

  it('recreates from the LOCAL image when the registry is unreachable', async function () {
    this.timeout(180000);
    const client = env.clients[idx];
    await waitForUp(client, appName, 'running before the registry goes away');

    // This assertion used to be "uninstalls locally when recreation fails". A
    // registry outage is a condition of this node right now, not a verdict on the
    // app: the layers are already on disk from the install, so the rebuild rides the
    // outage out on them. Deleting the app - and its appdata, fleet-wide - because a
    // registry blinked is the behaviour this replaces.
    await env.containers.registry.stop();

    const afterId = client.getLastEventId();
    await killAppContainer(client.container, appName);

    await waitForReconcileActuated(client, identifier, 'recreated', 120000, { afterId });
    // reaching Up at all proves it was neither removed nor left down
    await waitForUp(client, appName, 'recreated from the local image during the outage');
  });
});
