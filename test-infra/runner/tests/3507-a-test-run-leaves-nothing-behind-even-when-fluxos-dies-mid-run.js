// weight: medium
/*
 * A test run leaves nothing behind on the node: not when it ends, and not when
 * FluxOS dies while it runs.
 *
 * An app registered and not yet paid for exists only as a temporary message,
 * and its owner tests it with testappinstall. The run's containers run on the
 * node's own dockerd, so what it leaves is read there: containers and networks
 * carrying runonflux.role=testrun, and the run directory beside the apps folder.
 * The watch window is long enough that FluxOS can be killed while the run's
 * containers are up, which is the state a sweep at the next start must clear.
 *
 * The app is never installed: no row is written, at any point.
 */
import {
  describe, it, before,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { appOwnerKey, nodeKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { execInContainer, restartFluxos } from '../framework/container.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const REAL_NODES = 3;
const NODE = 1;
// long enough to kill FluxOS while the run's containers are up
const WATCH_MS = 45000;
// beside the harness apps folder, /mnt/appdata/flux-apps
const RUN_ROOT = '/mnt/appdata/testruns';

describe('a test run leaves nothing behind', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let appName;
  let messageHash;
  const client = () => env.clients[NODE];

  const listed = async (command) => {
    const { exitCode, stdout, stderr } = await execInContainer(client().container, command);
    if (exitCode !== 0) throw new Error(`${command} failed (exit ${exitCode}): ${stderr || stdout}`);
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  };
  const testRunContainers = () => listed('docker ps -a --filter label=runonflux.role=testrun --format "{{.Names}} {{.Status}}"');
  const testRunNetworks = () => listed('docker network ls --filter label=runonflux.role=testrun --format "{{.Name}}"');
  const runDirEntries = () => listed(`if [ -d ${RUN_ROOT} ]; then ls -A ${RUN_ROOT}; fi`);
  const assertNothingLeft = async () => {
    expect(await testRunContainers(), 'a test-run container is left on the node').to.deep.equal([]);
    expect(await testRunNetworks(), 'a test-run network is left on the node').to.deep.equal([]);
    expect(await runDirEntries(), 'a run directory is left on the node').to.deep.equal([]);
    expect(await dbClient(NODE + 1).localApp(appName), 'the app was installed').to.equal(null);
  };
  const ownerAuth = async () => (await authenticate(client().url, appOwnerKey())).zelidauth;

  before(async function () {
    this.timeout(420000);
    // Registration wants a peer each way; a fleet this small holds one each way.
    env = await createTestEnv({
      hookCtx: this,
      nodes: REAL_NODES,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1, testRunWatchMs: WATCH_MS } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c) => waitForBootSettled(c, 240000)));
    await waitFor(async () => {
      const [outgoing, incoming] = await Promise.all([client().getPeers(), client().getIncomingPeers()]);
      return (outgoing.data?.length ?? 0) >= 1 && (incoming.data?.length ?? 0) >= 1;
    }, { timeout: 120000, interval: 2000, label: 'the registering node has a peer each way' });

    appName = `e2etestrun${Date.now()}`;
    const result = await registerApp(client().url, nodeKey(NODE + 1), buildAppSpec({ name: appName }));
    expect(result.status, `fixture: the registration was refused: ${JSON.stringify(result)}`).to.equal('success');
    messageHash = result.data;
    await waitFor(async () => (await client().getTempMessages(messageHash)).data?.length > 0, {
      timeout: 60000, interval: 2000, label: 'the node holds the temporary message',
    });
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('runs the app outside the app machinery and removes everything when it ends', async function () {
    this.timeout(300000);
    const mark = client().getLastEventId();
    const testing = client().testAppInstall(messageHash, await ownerAuth());

    const { data: started } = await client().waitForEvent('testrun:started', (d) => d.app === appName, 180000, { afterId: mark });
    const running = await testRunContainers();
    expect(running.map((line) => line.split(' ')[0]), 'the run\'s containers are not on the node').to.deep.equal(started.containers);
    expect(await dbClient(NODE + 1).localApp(appName), 'the app was installed for its test').to.equal(null);

    const body = await testing;
    const { data: ended } = await client().waitForEvent('testrun:ended', (d) => d.runId === started.runId, 60000, { afterId: mark });
    expect(ended.allRunning, `the app did not keep running: ${body}`).to.equal(true);
    expect(body).to.match(/Nothing was installed/);
    await assertNothingLeft();
  });

  it('leaves nothing once FluxOS has started again after dying mid-run', async function () {
    this.timeout(420000);
    const mark = client().getLastEventId();
    const testing = client().testAppInstall(messageHash, await ownerAuth()).catch((error) => error);

    const { data: started } = await client().waitForEvent('testrun:started', (d) => d.app === appName, 180000, { afterId: mark });
    // canary: the state the sweep must clear is on the node
    expect((await testRunContainers()).length, 'fixture: the run\'s containers are not up').to.equal(started.containers.length);
    expect(await testRunNetworks(), 'fixture: the run\'s network is not up').to.have.lengthOf(1);
    expect(await runDirEntries(), 'fixture: the run\'s directory is not there').to.deep.equal([started.runId]);

    await restartFluxos(client().container);
    await testing;
    await client().waitForEvent('testrun:swept', () => true, 180000, { afterId: mark });

    await assertNothingLeft();
  });
});
