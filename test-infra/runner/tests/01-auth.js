import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { authenticate, signBtcMessage } from '../auth.js';
import { nodeClient } from '../framework/node-client.js';
import { nodeKey, appOwnerKey, fluxTeamKey, userKey } from '../framework/keys.js';
import { waitForApi } from '../framework/wait.js';

const node = nodeClient(1);

describe('Authentication', function () {
  before(async function () {
    await waitForApi(node);
  });

  it('should authenticate as node admin', async function () {
    const key = nodeKey(1);
    const auth = await authenticate(node.url, key);
    expect(auth.zelid).to.equal(key.zelid);
    expect(auth.zelidauth).to.be.a('string');
    expect(auth.signature).to.be.a('string');
  });

  it('should authenticate as app owner', async function () {
    const key = appOwnerKey();
    const auth = await authenticate(node.url, key);
    expect(auth.zelid).to.equal(key.zelid);
  });

  it('should authenticate as flux team', async function () {
    const key = fluxTeamKey();
    const auth = await authenticate(node.url, key);
    expect(auth.zelid).to.equal(key.zelid);
  });

  it('should authenticate as regular user', async function () {
    const key = userKey();
    const auth = await authenticate(node.url, key);
    expect(auth.zelid).to.equal(key.zelid);
  });

  it('should reject invalid signature', async function () {
    const key = nodeKey(1);
    const phraseRes = await node.getLoginPhrase();
    expect(phraseRes.status).to.equal('success');

    const wrongKey = userKey();
    const signature = await signBtcMessage(phraseRes.data, wrongKey.privkey);

    const res = await node.verifyLogin({
      zelid: key.zelid,
      loginPhrase: phraseRes.data,
      signature,
    });
    expect(res.status).to.equal('error');
  });

  it('should reject expired login phrase', async function () {
    const key = nodeKey(1);
    const expiredPhrase = '1600000000000someinvalidphrase';

    const signature = await signBtcMessage(expiredPhrase, key.privkey);
    const res = await node.verifyLogin({
      zelid: key.zelid,
      loginPhrase: expiredPhrase,
      signature,
    });
    expect(res.status).to.equal('error');
  });
});

describe('Privilege enforcement', function () {
  let fluxTeamAuth;
  let nodeAdminAuth;
  let appOwnerAuth;
  let userAuth;

  before(async function () {
    await waitForApi(node);
    fluxTeamAuth = await authenticate(node.url, fluxTeamKey());
    nodeAdminAuth = await authenticate(node.url, nodeKey(1));
    appOwnerAuth = await authenticate(node.url, appOwnerKey());
    userAuth = await authenticate(node.url, userKey());
  });

  describe('POST /flux/dosstate (fluxteam only)', function () {
    it('flux team can set DOS state', async function () {
      const res = await node.setDOSState(50, 'test', fluxTeamAuth.zelidauth);
      expect(res.status).to.equal('success');

      const state = await node.getDOSState();
      expect(state.data.dosState).to.equal(50);

      await node.setDOSState(0, null, fluxTeamAuth.zelidauth);
    });

    it('node admin cannot set DOS state', async function () {
      const res = await node.setDOSState(100, 'test', nodeAdminAuth.zelidauth);
      expect(res.status).to.equal('error');
      expect(res.data.code).to.equal(401);
    });

    it('app owner cannot set DOS state', async function () {
      const res = await node.setDOSState(100, 'test', appOwnerAuth.zelidauth);
      expect(res.status).to.equal('error');
      expect(res.data.code).to.equal(401);
    });

    it('regular user cannot set DOS state', async function () {
      const res = await node.setDOSState(100, 'test', userAuth.zelidauth);
      expect(res.status).to.equal('error');
      expect(res.data.code).to.equal(401);
    });
  });

  describe('admin endpoints', function () {
    it('node admin can access admin endpoints', async function () {
      const res = await node.get(`/flux/adjustkadena/testaccount/5?zelidauth=${encodeURIComponent(nodeAdminAuth.zelidauth)}`);
      expect(res.status).to.equal('success');
    });

    it('regular user cannot access admin endpoints', async function () {
      const res = await node.get(`/flux/adjustkadena/testaccount/5?zelidauth=${encodeURIComponent(userAuth.zelidauth)}`);
      expect(res.status).to.equal('error');
    });
  });
});
