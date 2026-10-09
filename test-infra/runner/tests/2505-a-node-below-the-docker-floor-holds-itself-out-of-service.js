// A node whose Docker is below the network minimum holds itself out of service and
// says why: the version it found, the version required, and to upgrade Docker and
// restart FluxOS. A node at or above the floor is not held.
//
// Harness nodes run one Docker release, at or above the real floor, so the node under
// test is given a floor above it (minimumDockerAllowedVersion), and the node beside it
// keeps the real one: the canary that the check passes a Docker that meets the floor.
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const BELOW = 0;
const AT_FLOOR = 1;
const RAISED_FLOOR = '99.0.0';

describe('2505 a node below the Docker floor holds itself out of service', function suite() {
  this.timeout(600000);

  let env;
  let dockerVersion;
  dumpLogsOnFailure(() => env);

  before(async function hook() {
    env = await createTestEnv({
      hookCtx: this,
      nodes: 2,
      tickerAutostart: false,
      nodeConfigOverrides: { [BELOW]: { minimumDockerAllowedVersion: RAISED_FLOOR } },
    });
    await Promise.all(env.clients.map((client) => waitForBootSettled(client, 240000)));
    dockerVersion = (await execInContainer(env.clients[BELOW].container, 'docker version -f {{.Server.Version}}')).stdout.trim();
  });

  after(async () => {
    await env?.teardown();
  });

  it('holds the node below the floor at DOS 100, naming the version it found, the one required, and what to do', async () => {
    let state;
    await waitFor(async () => {
      state = (await env.clients[BELOW].getDOSState())?.data;
      return state?.dosState === 100;
    }, { timeout: 90000, label: 'the node below the floor to hold itself out of service' });
    expect(state.dosMessage).to.include('Docker Version Error');
    expect(state.dosMessage).to.include(`v${RAISED_FLOOR}`);
    expect(state.dosMessage).to.include(`v${dockerVersion}`);
    expect(state.dosMessage).to.include('restart FluxOS');
  });

  it('does not hold the node whose Docker meets the floor', async () => {
    const state = (await env.clients[AT_FLOOR].getDOSState()).data;
    expect(state.dosState, state.dosMessage).to.not.equal(100);
    expect(String(state.dosMessage ?? '')).to.not.include('Docker Version Error');
  });
});
