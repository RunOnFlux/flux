/*
 * Every route whose handler reads its own request body answers a body over the limit with a 413,
 * through the route's real wiring, and the node goes on serving.
 *
 * A body the global JSON parser does not claim (text/plain here) reaches the handler as a stream,
 * and the handler collects it itself; bodyLimit is what bounds that. The routes are the ones whose
 * handlers call it; the unit suite reads the source for a handler that does not. Each request
 * carries the Flux team's session, so a route's privilege check is not what answers.
 *
 * A body at the limit is the canary: it is handled, not refused.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { fluxosPid } from '../framework/container.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import bodyLimitModule from '../../../ZelBack/src/services/utils/bodyLimit.js';

const { MAX_BODY_SIZE } = bodyLimitModule;

// Each route whose handler collects its body through bodyLimit.refuseIfTooLarge, once.
const ROUTES = [
  '/apps/appexec',
  '/apps/appregister',
  '/apps/appupdate',
  '/apps/calculatefiatandfluxprice',
  '/apps/checkdockerexistance',
  '/apps/getpublickey',
  '/apps/verifyappregistrationspecifications',
  '/apps/verifyappupdatespecifications',
  '/benchmark/signfluxnodetransaction',
  '/daemon/createmultisig',
  '/daemon/createrawtransaction',
  '/daemon/decoderawtransaction',
  '/daemon/decodescript',
  '/daemon/getaddressbalance',
  '/daemon/getaddressdeltas',
  '/daemon/getaddressmempool',
  '/daemon/getaddresstxids',
  '/daemon/getaddressutxos',
  '/daemon/getblockhashes',
  '/daemon/getspentinfo',
  '/daemon/sendrawtransaction',
  '/daemon/submitblock',
  '/daemon/verifymessage',
  '/flux/broadcastmessage',
  '/flux/checkappavailability',
  '/id/checkprivilege',
  '/id/logoutspecificsession',
  '/id/providesign',
  '/id/verifylogin',
  '/payment/verifypayment',
];

// Three nodes, peered, so routes gated on a settled boot and on policy reach their handlers.
const SUBJECT = 1;

describe('a body over the limit is refused by every handler that reads its own', function () {
  let env;
  dumpLogsOnFailure(() => env);

  let node;
  let pidBefore;

  // request() sends the body as JSON text, so a string of n characters is n + 2 on the wire.
  const post = (route, characters) => node.request('POST', route, {
    body: 'x'.repeat(characters - 2),
    headers: { 'Content-Type': 'text/plain', zelidauth: node.zelidauth },
  });

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, tickerAutostart: false });
    await bootAndPeer(env);
    node = env.clients[SUBJECT];
    pidBefore = await fluxosPid(node.container);
    expect(pidBefore, 'FluxOS running').to.be.a('number');
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('handles a body at the limit', async function () {
    this.timeout(60000);
    const res = await post('/daemon/verifymessage', MAX_BODY_SIZE);
    expect(res.status, JSON.stringify(res.data).slice(0, 200)).to.equal(200);
  });

  for (const route of ROUTES) {
    it(`answers a body over the limit with 413 on ${route}`, async function () {
      this.timeout(60000);
      const res = await post(route, MAX_BODY_SIZE + 1024);
      expect(res.status, JSON.stringify(res.data).slice(0, 200)).to.equal(413);
      expect(res.data?.data?.message).to.equal('Request body too large');
    });
  }

  it('goes on serving, on the FluxOS process it started with', async function () {
    this.timeout(60000);
    const version = await node.request('GET', '/flux/version');
    expect(version.status).to.equal(200);
    expect(await fluxosPid(node.container)).to.equal(pidBefore);
  });
});
