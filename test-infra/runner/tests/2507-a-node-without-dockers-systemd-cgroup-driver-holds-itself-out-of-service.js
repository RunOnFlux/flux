// A node whose cgroups are not the ones FluxOS runs apps in holds itself out of
// service and says why. Harness nodes run cgroup v2, with cgroup.kill, under Docker's
// systemd cgroup driver, so the node under test has its Docker switched to the
// cgroupfs driver and FluxOS restarted on it; the node beside it keeps the systemd
// driver: the canary that the check passes a node that meets it. The fleet boots
// first, since a node out of service refuses the login the harness boots a fleet
// through.
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, restartDockerd, restartFluxos } from '../framework/container.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const OFF_DRIVER = 0;
const ON_DRIVER = 1;

const cgroupDriver = async (client) => (await execInContainer(client.container, 'docker info -f {{.CgroupDriver}}')).stdout.trim();

describe('2507 a node without Docker\'s systemd cgroup driver holds itself out of service', function suite() {
  this.timeout(600000);

  let env;
  dumpLogsOnFailure(() => env);

  before(async function hook() {
    env = await createTestEnv({ hookCtx: this, nodes: 2, tickerAutostart: false });
    await Promise.all(env.clients.map((client) => waitForBootSettled(client, 240000)));
    const node = env.clients[OFF_DRIVER];
    // The driver set in the node's own daemon.json, merged over what the entrypoint wrote.
    const switched = await execInContainer(node.container, `node -e '
      const fs = require("fs");
      const target = "/etc/docker/daemon.json";
      const config = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : {};
      config["exec-opts"] = ["native.cgroupdriver=cgroupfs"];
      fs.writeFileSync(target, JSON.stringify(config, null, 2));
    '`);
    expect(switched.exitCode, switched.stderr).to.equal(0);
    await restartDockerd(node.container);
    expect(await cgroupDriver(node), 'fixture: Docker did not take the cgroupfs driver').to.equal('cgroupfs');
    await restartFluxos(node.container);
  });

  after(async () => {
    await env?.teardown();
  });

  it('holds the node at DOS 100, naming the driver it found, the one required, and what to do', async () => {
    let state;
    await waitFor(async () => {
      state = (await env.clients[OFF_DRIVER].getDOSState())?.data;
      return state?.dosState === 100;
    }, { timeout: 90000, label: 'the node without the systemd driver to hold itself out of service' });
    expect(state.dosMessage).to.include('Cgroup Error');
    expect(state.dosMessage).to.include('Docker\'s systemd cgroup driver (found cgroupfs)');
    expect(state.dosMessage).to.include('restart FluxOS');
  });

  it('does not hold the node whose Docker uses the systemd driver', async () => {
    expect(await cgroupDriver(env.clients[ON_DRIVER]), 'fixture: the canary\'s Docker').to.equal('systemd');
    const state = (await env.clients[ON_DRIVER].getDOSState()).data;
    expect(state.dosState, state.dosMessage).to.not.equal(100);
    expect(String(state.dosMessage ?? '')).to.not.include('Cgroup Error');
  });
});
