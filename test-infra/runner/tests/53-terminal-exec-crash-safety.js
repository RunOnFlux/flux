import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { io } from 'socket.io-client';
import { createTestEnv } from '../framework/test-env.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { execInContainer, getAppContainerStatus } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, seedSimpleApp } from '../framework/reconciler-suite.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// MUST-PASS gate. Opening the web terminal must never take the node down.
//
// The /terminal socket.io handler runs its work inside an async socket listener,
// so anything that throws there is an unhandled rejection -> the FluxOS process
// exits(1). Production hit this twice on one node in 90 minutes: a customer opened
// the console on a container that was not running, dockerode handed back a null
// exec, and `exec.start` on null killed FluxOS. Each restart also re-armed the
// syncthing first-run gate that blocks g: primary election, so a UI click became
// an app outage.
//
// Two distinct ways in, both asserted here:
//   1. container present but NOT running -> daemon rejects exec create (409),
//      dockerode yields a null exec.
//   2. container absent -> dockerService.getDockerContainerByIdOrName reads .Id
//      off an undefined lookup result and rejects before the handler's own
//      `if (!container)` guard can run.
//
// The assertion that matters in both cases is the same: a socket error reaches the
// client AND the FluxOS process is the same one it was before (an exit(1) is
// invisible from outside once the watchdog respawns it, so we compare the pid).

const TERMINAL_TIMEOUT_MS = 20000;

// The node app.js child pid, written by the image entrypoint watchdog. It changes
// if and only if FluxOS died and was respawned.
async function fluxosPid(container) {
  const { stdout } = await execInContainer(container, 'cat /tmp/fluxos.pid 2>/dev/null || echo ""');
  return stdout.trim();
}

async function apiAlive(client) {
  const res = await client.get('/flux/version').catch(() => null);
  return !!res;
}

// Open the /terminal namespace, ask for an exec, and resolve with whatever the
// handler reports: { error } on a clean failure, { opened: true } if it streamed,
// { timedOut: true } if nothing came back at all. Silence is deliberately NOT a
// rejection - a node that died mid-request answers nothing, so we let the caller's
// pid assertion report "the handler crashed the process" rather than masking it as
// a generic timeout.
function openTerminal(client, zelidauth, nameOrId) {
  return new Promise((resolve, reject) => {
    const socket = io(`${client.url}/terminal`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: TERMINAL_TIMEOUT_MS,
    });

    const done = (result) => {
      socket.close();
      resolve(result);
    };

    const timer = setTimeout(() => done({ timedOut: true }), TERMINAL_TIMEOUT_MS);
    timer.unref?.();

    socket.on('error', (message) => {
      clearTimeout(timer);
      done({ error: String(message) });
    });
    socket.on('show', () => {
      clearTimeout(timer);
      done({ opened: true });
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(new Error(`terminal: connect_error ${err.message}`));
    });

    socket.on('connect', () => {
      socket.emit('exec', zelidauth, nameOrId, 'sh', '', 'root');
    });
  });
}

describe('docker terminal fails cleanly and never crashes the node', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let client;
  let zelidauth;
  const appName = `e2eterm${Date.now()}`;
  const identifier = `${appName}_${appName}`;

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    const { index } = await seedSimpleApp(env, appName);
    client = env.clients[index];
    ({ zelidauth } = await authenticate(client.url, appOwnerKey()));

    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return !!(status && status.status.startsWith('Up'));
    }, { timeout: 90000, interval: 3000, label: 'app container running before terminal tests' });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('reports an error instead of crashing when the container is not running', async function () {
    this.timeout(180000);

    // operator stop, so the reconciler leaves it down for the duration of the test
    await client.getAuthed(`/apps/appstop/${appName}`, zelidauth);
    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName, { all: true });
      return !!(status && !status.status.startsWith('Up'));
    }, { timeout: 60000, interval: 2000, label: 'app container stopped' });

    const pidBefore = await fluxosPid(client.container);
    expect(pidBefore).to.not.equal('');

    const result = await openTerminal(client, zelidauth, identifier);

    // node survival first: it is the invariant, and a crash explains any other failure
    expect(await fluxosPid(client.container), 'FluxOS restarted - the handler crashed the process').to.equal(pidBefore);
    expect(await apiAlive(client)).to.equal(true);
    expect(result.error, 'expected a socket error, not a live terminal').to.be.a('string');
  });

  it('reports an error instead of crashing when the container does not exist', async function () {
    this.timeout(120000);

    // the app half of the identifier still resolves for the ownership check, so
    // this gets past auth and dies in the container lookup - the shape you get
    // when a component was renamed or removed underneath an open management UI
    const pidBefore = await fluxosPid(client.container);
    const result = await openTerminal(client, zelidauth, `nosuch_${appName}`);

    expect(await fluxosPid(client.container), 'FluxOS restarted - the handler crashed the process').to.equal(pidBefore);
    expect(await apiAlive(client)).to.equal(true);
    expect(result.error, 'expected a socket error, not a live terminal').to.be.a('string');
  });
});
