import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { authenticate, signBtcMessage } from '../auth.js';
import { nodeKey, appOwnerKey, fluxTeamKey, userKey } from '../framework/keys.js';
import { createTestEnv } from '../framework/test-env.js';
import { waitFor, waitForDaemonReady } from '../framework/wait.js';
import { restartFluxos } from '../framework/container.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

let env;
let node;

describe('Authentication', function () {
  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this, nodes: 1 });
    node = env.clients[0];
    await waitForDaemonReady(node);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
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
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this, nodes: 1 });
    node = env.clients[0];
    await waitForDaemonReady(node);
    fluxTeamAuth = await authenticate(node.url, fluxTeamKey());
    nodeAdminAuth = await authenticate(node.url, nodeKey(1));
    appOwnerAuth = await authenticate(node.url, appOwnerKey());
    userAuth = await authenticate(node.url, userKey());
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
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
      const res = await node.getAuthed('/id/activeloginphrases', nodeAdminAuth.zelidauth);
      expect(res.status).to.equal('success');
      expect(res.data).to.be.an('array');
    });

    it('regular user cannot access admin endpoints', async function () {
      const res = await node.getAuthed('/id/activeloginphrases', userAuth.zelidauth);
      expect(res.status).to.equal('error');
    });
  });
});

// A login's signature is its session credential. The login websocket hands it to
// whoever holds the login phrase, for the first minute after the login only, and
// a FluxOS restart inside that minute neither ends the login nor extends the
// minute.
describe('A login across a FluxOS restart', function () {
  let login;

  // What the login websocket answers for a login phrase: its fields, keyed as
  // the node encodes them (data[signature], ...). Node's own WebSocket client.
  function loginSocketAnswer(loginPhrase) {
    return new Promise((resolve, reject) => {
      const ws = new globalThis.WebSocket(`${node.url.replace(/^http/, 'ws')}/ws/id/${encodeURIComponent(loginPhrase)}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('the login websocket did not answer within 10 s'));
      }, 10000);
      ws.onmessage = (event) => {
        clearTimeout(timer);
        ws.close();
        resolve(new URLSearchParams(String(event.data)));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('the login websocket failed'));
      };
    });
  }

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this, nodes: 1 });
    node = env.clients[0];
    await waitForDaemonReady(node);
    login = await authenticate(node.url, nodeKey(1));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('hands the login its signature through the login websocket right after the login', async function () {
    const answer = await loginSocketAnswer(login.loginPhrase);
    expect(answer.get('status')).to.equal('success');
    expect(answer.get('data[signature]')).to.equal(login.signature);
  });

  it('keeps the login through a FluxOS restart', async function () {
    this.timeout(180000);
    await restartFluxos(node.container);
    await waitFor(async () => (await node.getAuthed('/id/activeloginphrases', login.zelidauth)).status === 'success', {
      timeout: 60000, interval: 2000, label: 'the login accepted after the restart',
    });
  });

  it('stops handing out the signature a minute after the login, across the restart', async function () {
    this.timeout(240000);
    let answer;
    // the signature's TTL is a minute, and mongo removes expired rows once a minute
    await waitFor(async () => {
      answer = await loginSocketAnswer(login.loginPhrase);
      return answer.get('status') === 'success' && !answer.has('data[signature]');
    }, { timeout: 180000, interval: 5000, label: 'the login websocket answering without the signature' });
    expect(answer.get('data[zelid]')).to.equal(login.zelid);
  });
});
