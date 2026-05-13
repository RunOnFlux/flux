import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { setNodeStatus, clearNodeStatus } from '../framework/daemon-control.js';
import { waitForDaemonReady, waitForNodeStatus, waitForDosChanged } from '../framework/wait.js';

describe('App removal: confirmation loss', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false });
    await waitForDaemonReady(env.clients[0]);
    await waitForNodeStatus(env.clients[0], (d) => d.confirmed === true, 30000);
  });

  after(async function () {
    this.timeout(30000);
    await clearNodeStatus('198.18.1.0');
    await env?.teardown();
  });

  it('should detect confirmation loss via monitor event', async function () {
    this.timeout(30000);
    await setNodeStatus('198.18.1.0', 'EXPIRED');
    const event = await waitForNodeStatus(env.clients[0], (d) => d.confirmed === false, 20000);
    expect(event.data.confirmed).to.equal(false);
  });
});

describe('App removal: DOS state', function () {
  let env;
  let fluxTeamAuth;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false });
    await waitForDaemonReady(env.clients[0]);
    fluxTeamAuth = await authenticate(env.clients[0].url, fluxTeamKey());
  });

  after(async function () {
    this.timeout(30000);
    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
    await env?.teardown();
  });

  it('should set dosState to 100 and confirm via event', async function () {
    this.timeout(15000);
    await env.clients[0].setDOSState(100, 'test DOS block', fluxTeamAuth.zelidauth);
    const event = await waitForDosChanged(env.clients[0], (d) => d.dosState === 100, 10000);
    expect(event.data.dosState).to.equal(100);
    expect(event.data.dosMessage).to.equal('test DOS block');
  });

  it('should resume normal state when DOS cleared', async function () {
    this.timeout(15000);
    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
    const event = await waitForDosChanged(env.clients[0], (d) => d.dosState === 0, 10000);
    expect(event.data.dosState).to.equal(0);
    expect(event.data.dosMessage).to.be.null;
  });
});
