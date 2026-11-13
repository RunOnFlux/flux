// weight: medium
import {
  describe, it, before,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { buildAppSpec, buildAppMessage, registerApp } from '../framework/app-helper.js';
import { buildEnterpriseBlob } from '../framework/enterprise-helper.js';
import { appOwnerKey, nodeKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { waitFor } from '../framework/wait.js';
import { execInContainer } from '../framework/container.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

// An enterprise specification carries its compose and contacts only encrypted,
// inside `enterprise`. A peer's message whose enterprise specification also
// carries a compose in plain is refused by every node, whether or not it can
// decrypt, and its owner's test install of it leaves nothing on the node. A
// registration or an update carrying it through a node's own API is refused, and
// an enterprise registration carrying its compose only encrypted is taken.
//
// The blob is a real encryption of the same compose, so a node that decrypts it
// finds a valid specification: only the plain copy beside it is wrong. Node 1 is
// Arcane and registers, from the middle of the ring where it has a peer each way;
// node 0 is legacy, and node 2 Arcane. The stub peer reaches every node.

const LEGACY = 0;
const ARCANE = 1;
const REAL_NODES = 3;
const STUB_INDEX = 3;
const realNodes = [ARCANE, LEGACY];
const REFUSAL = 'An enterprise app carries its compose and contacts encrypted in enterprise, and nothing in plain';

describe('an enterprise message carrying its compose in plain is taken by no node', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let stub;
  const stamp = Date.now();
  const plainName = `e2eentplain${stamp}`;
  const canaryName = `e2eentcanary${stamp}`;
  let plainMessage;
  let canaryMessage;

  // Keyed by node index: event ids are each node's own.
  const marks = () => Object.fromEntries(realNodes.map((i) => [i, env.clients[i].getLastEventId()]));

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: REAL_NODES + 1,
      legacyNodes: [LEGACY],
      stubPeers: [STUB_INDEX],
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    stub = env.stubPeerClients.get(STUB_INDEX);
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    expect(await stub.connectedNodes(), 'fixture: the stub reaches every node').to.equal(REAL_NODES);
    const attested = await Promise.all(realNodes.map(async (i) => (await env.clients[i].request('GET', `/flux/isarcaneos?_=${Date.now()}`)).data?.data));
    expect(attested, 'fixture: only the Arcane node reports itself attested').to.deep.equal([true, false]);

    await waitFor(async () => {
      const [outgoing, incoming] = await Promise.all([env.clients[ARCANE].getPeers(), env.clients[ARCANE].getIncomingPeers()]);
      return (outgoing.data?.length ?? 0) >= 1 && (incoming.data?.length ?? 0) >= 1;
    }, { timeout: 120000, interval: 2000, label: 'the registering node has a peer each way' });

    const plain = buildAppSpec({ name: plainName });
    plainMessage = await buildAppMessage({ ...plain, enterprise: buildEnterpriseBlob(plain.compose, plain.contacts) });
    canaryMessage = await buildAppMessage(buildAppSpec({ name: canaryName, enterprise: true }));
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('is refused by a node that decrypts and by one that cannot', async function () {
    this.timeout(120000);
    const afterIds = marks();

    await stub.broadcast(plainMessage);
    await stub.broadcast(canaryMessage);

    await Promise.all(realNodes.map(async (i) => {
      const client = env.clients[i];
      const refused = await client.waitForEvent('network:appmessageRefused',
        (d) => d.hash === plainMessage.hash, 60000, { afterId: afterIds[i] });
      expect(refused.data.reason, `node ${i} refused it for another reason`).to.equal(REFUSAL);
      await client.waitForEvent('network:appmessage',
        (d) => d.hash === canaryMessage.hash, 60000, { afterId: afterIds[i] });
      expect((await client.getTempMessages(plainMessage.hash)).data, `node ${i} stored it`).to.deep.equal([]);
    }));
  });

  it('leaves nothing on a node that cannot decrypt when its owner test-installs it', async function () {
    this.timeout(300000);
    const client = env.clients[LEGACY];
    const { zelidauth } = await authenticate(client.url, appOwnerKey());

    const body = await client.testAppInstall(plainMessage.hash, zelidauth);

    // The owner of a message the node holds may test it; of one it does not, only the flux team.
    expect(body, 'the node holds the message').to.match(/Unauthorized/);
    expect(await dbClient(LEGACY + 1).localApp(plainName), 'the app is installed on the node').to.equal(null);
    const containers = await execInContainer(client.container, 'docker ps -a --format "{{.Names}}"');
    expect(containers.exitCode, `fixture: could not list the node's containers: ${containers.output}`).to.equal(0);
    expect(containers.output, 'a container of the app is on the node').to.not.include(`_${plainName}`);
  });

  ['fluxappregister', 'fluxappupdate'].forEach((type) => {
    it(`refuses ${type === 'fluxappregister' ? 'a registration' : 'an update'} through a node's own API that carries its compose in plain`, async function () {
      this.timeout(120000);
      const spec = buildAppSpec({ name: `e2eentdoor${type === 'fluxappregister' ? 'reg' : 'upd'}${stamp}` });
      const answer = await registerApp(env.clients[ARCANE].url, nodeKey(ARCANE + 1),
        { ...spec, enterprise: buildEnterpriseBlob(spec.compose, spec.contacts) }, type);

      expect(answer.status, JSON.stringify(answer)).to.equal('error');
      expect(answer.data?.message).to.equal(REFUSAL);
    });
  });

  it('takes an enterprise registration through a node\'s own API that carries its compose only encrypted', async function () {
    this.timeout(120000);
    const answer = await registerApp(env.clients[ARCANE].url, nodeKey(ARCANE + 1), buildAppSpec({ name: `e2eentdoorok${stamp}`, enterprise: true }));

    expect(answer.status, JSON.stringify(answer)).to.equal('success');
  });
});
