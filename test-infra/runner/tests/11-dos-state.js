import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { nodeClient } from '../framework/node-client.js';
import { nodeKey, fluxTeamKey, appOwnerKey, userKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { waitForApi } from '../framework/wait.js';

const node = nodeClient(1);

describe('DOS state management', function () {
  let fluxTeamAuth;

  before(async function () {
    await waitForApi(node);
    fluxTeamAuth = await authenticate(node.url, fluxTeamKey());
  });

  after(async function () {
    await node.setDOSState(0, null, fluxTeamAuth.zelidauth);
  });

  it('should start with dosState 0', async function () {
    await node.setDOSState(0, null, fluxTeamAuth.zelidauth);
    const state = await node.getDOSState();
    expect(state.data.dosState).to.equal(0);
  });

  it('should accept value set via fluxteam endpoint', async function () {
    const res = await node.setDOSState(50, null, fluxTeamAuth.zelidauth);
    expect(res.status).to.equal('success');
  });

  it('should reflect exact numeric value set', async function () {
    await node.setDOSState(42, null, fluxTeamAuth.zelidauth);
    const state = await node.getDOSState();
    expect(state.data.dosState).to.equal(42);
  });

  it('should accept dosMessage alongside dosState', async function () {
    await node.setDOSState(100, 'integration test DOS', fluxTeamAuth.zelidauth);
    const state = await node.getDOSState();
    expect(state.data.dosState).to.equal(100);
    expect(state.data.dosMessage).to.equal('integration test DOS');
  });

  it('should clear dosState back to 0', async function () {
    await node.setDOSState(0, null, fluxTeamAuth.zelidauth);
    const state = await node.getDOSState();
    expect(state.data.dosState).to.equal(0);
  });

  it('should clear dosMessage to null', async function () {
    await node.setDOSState(0, null, fluxTeamAuth.zelidauth);
    const state = await node.getDOSState();
    expect(state.data.dosMessage).to.be.null;
  });

  it('should reject set from node admin', async function () {
    const adminAuth = await authenticate(node.url, nodeKey(1));
    const res = await node.setDOSState(100, 'denied', adminAuth.zelidauth);
    expect(res.status).to.equal('error');
    expect(res.data.code).to.equal(401);
  });

  it('should reject set from app owner', async function () {
    const ownerAuth = await authenticate(node.url, appOwnerKey());
    const res = await node.setDOSState(100, 'denied', ownerAuth.zelidauth);
    expect(res.status).to.equal('error');
  });

  it('should reject set from regular user', async function () {
    const userAuth = await authenticate(node.url, userKey());
    const res = await node.setDOSState(100, 'denied', userAuth.zelidauth);
    expect(res.status).to.equal('error');
  });

  it('should accept threshold values (99 vs 100)', async function () {
    await node.setDOSState(99, 'below threshold', fluxTeamAuth.zelidauth);
    let state = await node.getDOSState();
    expect(state.data.dosState).to.equal(99);

    await node.setDOSState(100, 'at threshold', fluxTeamAuth.zelidauth);
    state = await node.getDOSState();
    expect(state.data.dosState).to.equal(100);
  });
});
