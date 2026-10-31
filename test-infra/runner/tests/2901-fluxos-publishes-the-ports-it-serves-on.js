import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, releaseFluxos, shutdownFluxosGracefully } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// FluxOS publishes the ports it is serving on, and its process id, in
// /run/fluxos/fluxos.json, and takes the file away when it stops cleanly, so
// the file means "FluxOS is serving here". fluxd and fluxbench read it.
//
// The ports are checked against the sockets the FluxOS process holds and
// against each listener answering, not against configuration. Each clean stop
// - a service restart (SIGTERM), a system shutdown (SIGTERM with the shutdown
// marker), and pm2's stop (SIGINT) - is held down after FluxOS exits, so the
// file's absence is read while nothing is serving, and the next start
// publishes it again.

const PORT_FILE = '/run/fluxos/fluxos.json';
const API_PORT = 16127;

describe('FluxOS publishes the ports it serves on', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const node = () => env.clients[0].container;
  const sh = async (command) => execInContainer(node(), command);
  const fluxosPid = async () => Number((await sh('cat /tmp/fluxos.pid')).stdout.trim());
  const readPortFile = async () => {
    const r = await sh(`cat ${PORT_FILE}`);
    return r.exitCode === 0 ? JSON.parse(r.stdout) : null;
  };
  const portFilePresent = async () => (await sh(`test -e ${PORT_FILE}`)).exitCode === 0;
  const waitForPortFile = async (label) => waitFor(portFilePresent, { timeout: 60000, interval: 500, label });

  // Stop FluxOS with a signal and keep it down; resolves once the process has exited.
  const stopHeld = async (signal) => {
    const pid = await fluxosPid();
    expect(pid, 'fixture: a FluxOS pid').to.be.above(0);
    await sh('touch /tmp/fluxos.hold');
    const signalled = await sh(`kill -${signal} ${pid}`);
    expect(signalled.exitCode, `fixture: ${signal} delivered to ${pid}`).to.equal(0);
    await waitFor(async () => (await sh(`kill -0 ${pid} 2>/dev/null`)).exitCode !== 0, {
      timeout: 120000, interval: 250, label: `FluxOS ${pid} to exit on ${signal}`,
    });
  };

  before(async function () {
    this.timeout(180000);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false });
    await waitForPortFile('the port file after boot');
  });

  after(async function () {
    this.timeout(60000);
    await sh('rm -f /tmp/fluxos.hold /run/nologin').catch(() => {});
    await env?.teardown();
  });

  it('names the three ports FluxOS is listening on and its process id, world-readable', async function () {
    this.timeout(60000);
    const pid = await fluxosPid();
    const ports = await readPortFile();
    console.log(`# ${PORT_FILE}: ${JSON.stringify(ports)}; FluxOS pid ${pid}`);
    expect(ports).to.deep.equal({
      apiPort: API_PORT, apiPortHttps: API_PORT + 1, uiPort: API_PORT - 1, pid,
    });

    const modes = (await sh(`stat -c '%a %U' ${PORT_FILE} /run/fluxos`)).stdout.trim().split('\n');
    expect(modes, 'file and directory modes').to.deep.equal(['644 root', '755 root']);
    const leftovers = (await sh('ls -A /run/fluxos')).stdout.trim().split('\n');
    expect(leftovers, 'nothing but the file in its directory').to.deep.equal(['fluxos.json']);

    // The sockets the FluxOS process itself holds.
    const listening = (await sh(`ss -Hltnp | grep 'pid=${pid},' | awk '{print $4}' | sed 's/.*://' | sort -un`))
      .stdout.trim().split('\n').map(Number);
    console.log(`# FluxOS pid ${pid} listens on ${listening.join(', ')}`);
    expect(listening).to.include.members([ports.apiPort, ports.apiPortHttps, ports.uiPort]);

    // And each answers as the listener it is named for.
    const api = await sh(`curl -sf -m 5 http://127.0.0.1:${ports.apiPort}/flux/version`);
    expect(api.exitCode, 'the HTTP API answers on apiPort').to.equal(0);
    const https = await sh(`curl -skf -m 5 https://127.0.0.1:${ports.apiPortHttps}/flux/version`);
    expect(https.exitCode, 'the HTTPS API answers on apiPortHttps').to.equal(0);
    const ui = await sh(`curl -sf -m 5 http://127.0.0.1:${ports.uiPort}/health`);
    expect(ui.stdout, 'the UI answers on uiPort').to.equal('OK');
  });

  it('removes the file on a service restart (SIGTERM) and publishes it again on the next start', async function () {
    this.timeout(240000);
    await stopHeld('TERM');
    expect(await portFilePresent(), 'the file once FluxOS has stopped').to.equal(false);
    await releaseFluxos(node());
    await waitForPortFile('the port file after the restart');
    expect(await readPortFile()).to.deep.equal({
      apiPort: API_PORT, apiPortHttps: API_PORT + 1, uiPort: API_PORT - 1, pid: await fluxosPid(),
    });
  });

  it('removes the file on a system shutdown', async function () {
    this.timeout(240000);
    expect(await portFilePresent(), 'fixture: the file before the shutdown').to.equal(true);
    await shutdownFluxosGracefully(node(), { hold: true });
    expect(await portFilePresent(), 'the file once FluxOS has shut down').to.equal(false);
    await releaseFluxos(node());
    await waitForPortFile('the port file after the shutdown');
  });

  it('removes the file when pm2 stops FluxOS (SIGINT)', async function () {
    this.timeout(240000);
    expect(await portFilePresent(), 'fixture: the file before the stop').to.equal(true);
    await stopHeld('INT');
    expect(await portFilePresent(), 'the file once FluxOS has stopped').to.equal(false);
    await releaseFluxos(node());
    await waitForPortFile('the port file after the start');
  });
});
