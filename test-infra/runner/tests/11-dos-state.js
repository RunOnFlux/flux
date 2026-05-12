import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey, fluxTeamKey, appOwnerKey, userKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { waitForApi } from '../framework/wait.js';

let env;
let fluxTeamAuth;

describe('DOS state management', function () {
  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1 });
    await waitForApi(env.clients[0]);
    fluxTeamAuth = await authenticate(env.clients[0].url, fluxTeamKey());
  });

  after(async function () {
    this.timeout(30000);
    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
    await env?.teardown();
  });

  it('should start with dosState 0', async function () {
    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
    const state = await env.clients[0].getDOSState();
    expect(state.data.dosState).to.equal(0);
  });

  it('should accept value set via fluxteam endpoint', async function () {
    const res = await env.clients[0].setDOSState(50, null, fluxTeamAuth.zelidauth);
    expect(res.status).to.equal('success');
  });

  it('should reflect exact numeric value set', async function () {
    await env.clients[0].setDOSState(42, null, fluxTeamAuth.zelidauth);
    const state = await env.clients[0].getDOSState();
    expect(state.data.dosState).to.equal(42);
  });

  it('should accept dosMessage alongside dosState', async function () {
    await env.clients[0].setDOSState(100, 'integration test DOS', fluxTeamAuth.zelidauth);
    const state = await env.clients[0].getDOSState();
    expect(state.data.dosState).to.equal(100);
    expect(state.data.dosMessage).to.equal('integration test DOS');
  });

  it('should clear dosState back to 0', async function () {
    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
    const state = await env.clients[0].getDOSState();
    expect(state.data.dosState).to.equal(0);
  });

  it('should clear dosMessage to null', async function () {
    await env.clients[0].setDOSState(0, null, fluxTeamAuth.zelidauth);
    const state = await env.clients[0].getDOSState();
    expect(state.data.dosMessage).to.be.null;
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

  it('should accept threshold values (99 vs 100)', async function () {
    await env.clients[0].setDOSState(99, 'below threshold', fluxTeamAuth.zelidauth);
    let state = await env.clients[0].getDOSState();
    expect(state.data.dosState).to.equal(99);

    await env.clients[0].setDOSState(100, 'at threshold', fluxTeamAuth.zelidauth);
    state = await env.clients[0].getDOSState();
    expect(state.data.dosState).to.equal(100);
  });
});
