import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { setNodeStatus, clearNodeStatus } from '../framework/daemon-control.js';
import { waitForDaemonReady, waitForNodeStatus, waitForDosChanged, waitFor } from '../framework/wait.js';

describe('Confirmation loss consequences', function () {
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

  it('should block the spawner when node loses confirmation', async function () {
    this.timeout(60000);
    await setNodeStatus('198.18.1.0', 'EXPIRED');
    await waitForNodeStatus(env.clients[0], (d) => d.confirmed === false, 20000);
    await waitFor(
      () => env.nodeHasLog(0, 'Flux Node not Confirmed'),
      { timeout: 30000, interval: 3000, label: 'spawner blocked by confirmation loss' },
    );
    expect(env.nodeHasLog(0, 'Flux Node not Confirmed')).to.equal(true);
  });
});

describe('DOS loginPhrase consequences', function () {
  let env;
  let fluxTeamAuth;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false });
    await waitForDaemonReady(env.clients[0]);
    fluxTeamAuth = await authenticate(env.clients[0].url, fluxTeamKey());
    const baseline = await env.clients[0].getLoginPhrase();
    expect(baseline.status).to.equal('success');
  });

  afterEach(async function () {
    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should allow loginPhrase at dosState 10 (boundary)', async function () {
    await env.clients[0].setDOSState(10, null, fluxTeamAuth.zelidauth);
    await waitForDosChanged(env.clients[0], (d) => d.dosState === 10, 10000);
    const res = await env.clients[0].getLoginPhrase();
    expect(res.status).to.equal('success');
  });

  it('should block loginPhrase at dosState 11 (boundary)', async function () {
    await env.clients[0].setDOSState(11, null, fluxTeamAuth.zelidauth);
    await waitForDosChanged(env.clients[0], (d) => d.dosState === 11, 10000);
    const res = await env.clients[0].getLoginPhrase();
    expect(res.status).to.equal('error');
    expect(res.data.name).to.equal('CONNERROR');
  });

  it('should block loginPhrase at dosState 100 with DOS error', async function () {
    await env.clients[0].setDOSState(100, 'full DOS', fluxTeamAuth.zelidauth);
    await waitForDosChanged(env.clients[0], (d) => d.dosState === 100, 10000);
    const res = await env.clients[0].getLoginPhrase();
    expect(res.status).to.equal('error');
    expect(res.data.code).to.equal(100);
  });

  it('should block loginPhrase when dosMessage is non-null even at dosState 0', async function () {
    await env.clients[0].setDOSState(0, 'message-only block', fluxTeamAuth.zelidauth);
    await waitForDosChanged(env.clients[0], (d) => d.dosMessage === 'message-only block', 10000);
    const res = await env.clients[0].getLoginPhrase();
    expect(res.status).to.equal('error');
  });

  it('should restore loginPhrase when DOS cleared', async function () {
    await env.clients[0].setDOSState(50, 'blocking', fluxTeamAuth.zelidauth);
    await waitForDosChanged(env.clients[0], (d) => d.dosState === 50, 10000);
    const blocked = await env.clients[0].getLoginPhrase();
    expect(blocked.status).to.equal('error');

    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
    await waitForDosChanged(env.clients[0], (d) => d.dosState === 0, 10000);
    const restored = await env.clients[0].getLoginPhrase();
    expect(restored.status).to.equal('success');
  });
});
