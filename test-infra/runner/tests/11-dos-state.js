import { describe, it, before, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey, fluxTeamKey, appOwnerKey, userKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { waitForDaemonReady, waitForDosChanged } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

let env;
let fluxTeamAuth;

describe('DOS state management', function () {
  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1 });
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

  it('should reflect set values via getDOSState API', async function () {
    await env.clients[0].setDOSState(42, 'test message', fluxTeamAuth.zelidauth);
    await waitForDosChanged(env.clients[0], (d) => d.dosState === 42, 10000);
    const res = await env.clients[0].getDOSState();
    expect(res.status).to.equal('success');
    expect(res.data.dosState).to.equal(42);
    expect(res.data.dosMessage).to.equal('test message');
  });

  it('should allow loginPhrase at dosState 10 (boundary: > 10 not >= 10)', async function () {
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
  });

  it('should block loginPhrase when dosMessage is non-null at dosState 0', async function () {
    await env.clients[0].setDOSState(0, 'message-only', fluxTeamAuth.zelidauth);
    await waitForDosChanged(env.clients[0], (d) => d.dosMessage === 'message-only', 10000);
    const res = await env.clients[0].getLoginPhrase();
    expect(res.status).to.equal('error');
  });

  it('should restore loginPhrase when DOS fully cleared', async function () {
    await env.clients[0].setDOSState(50, 'blocking', fluxTeamAuth.zelidauth);
    await waitForDosChanged(env.clients[0], (d) => d.dosState === 50, 10000);
    expect((await env.clients[0].getLoginPhrase()).status).to.equal('error');

    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
    await waitForDosChanged(env.clients[0], (d) => d.dosState === 0, 10000);
    const res = await env.clients[0].getLoginPhrase();
    expect(res.status).to.equal('success');
  });

  it('should reject set from node admin', async function () {
    const adminAuth = await authenticate(env.clients[0].url, nodeKey(1));
    const res = await env.clients[0].setDOSState(100, 'denied', adminAuth.zelidauth);
    expect(res.status).to.equal('error');
    expect(res.data.code).to.equal(401);
  });

  it('should reject set from app owner', async function () {
    const ownerAuth = await authenticate(env.clients[0].url, appOwnerKey());
    const res = await env.clients[0].setDOSState(100, 'denied', ownerAuth.zelidauth);
    expect(res.status).to.equal('error');
  });

  it('should reject set from regular user', async function () {
    const userAuth = await authenticate(env.clients[0].url, userKey());
    const res = await env.clients[0].setDOSState(100, 'denied', userAuth.zelidauth);
    expect(res.status).to.equal('error');
  });
});
