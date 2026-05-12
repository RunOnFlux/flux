import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { setNodeStatus, clearNodeStatus } from '../framework/daemon-control.js';
import { waitForApi, waitFor } from '../framework/wait.js';

describe('App removal: confirmation loss', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false });
    await waitForApi(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await clearNodeStatus('198.18.1.0');
    await env?.teardown();
  });

  it('should detect confirmation loss via monitorNodeStatus', async function () {
    this.timeout(60000);
    await setNodeStatus('198.18.1.0', 'EXPIRED');
    await waitFor(async () => {
      const res = await env.clients[0].getInstalledApps();
      return res.status === 'success';
    }, { timeout: 50000, interval: 5000, label: 'monitorNodeStatus detection' });
    const res = await env.clients[0].getNodeStatus();
    expect(res.status).to.equal('success');
  });
});

describe('App removal: DOS state', function () {
  let env;
  let fluxTeamAuth;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false });
    await waitForApi(env.clients[0]);
    fluxTeamAuth = await authenticate(env.clients[0].url, fluxTeamKey());
  });

  after(async function () {
    this.timeout(30000);
    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
    await env?.teardown();
  });

  it('should not spawn apps when dosState >= 100', async function () {
    const res = await env.clients[0].setDOSState(100, 'test DOS block', fluxTeamAuth.zelidauth);
    expect(res.status).to.equal('success');
    const state = await env.clients[0].getDOSState();
    expect(state.data.dosState).to.equal(100);
  });

  it('should resume normal state when DOS cleared', async function () {
    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
    const state = await env.clients[0].getDOSState();
    expect(state.data.dosState).to.equal(0);
    expect(state.data.dosMessage).to.be.null;
  });
});
