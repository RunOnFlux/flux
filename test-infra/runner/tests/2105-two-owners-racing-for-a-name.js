import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { appOwnerKey, otherOwnerKeys, nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { restartFluxos } from '../framework/container.js';
import {
  stopTicker, startTicker, queueAppTx, advanceBlock, advanceBlocks,
} from '../framework/daemon-control.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// Two owners register the same free name close together, so both
// registrations pass every node's check on arrival. The chain decides who holds
// it: in one block, the registration earliest in the block; across blocks, the
// first confirmed, for as long as its app is live. Every node agrees, and so
// does a node that restarts and rebuilds its registry from the message log.
//
// In the one-block case the registration placed first was signed first, so a
// node ordering by signature time, or by promotion, gives the name to the
// other owner.

const NODES = 4;
const RESTARTED = 1;

describe('two owners racing for one app name: the chain decides who holds it', function () {
  let env;
  const alice = appOwnerKey();
  const [mallory] = otherOwnerKeys();
  const stamp = Date.now();
  const sameBlock = `e2eracesame${stamp}`;
  const laterBlock = `e2eracelater${stamp}`;

  dumpLogsOnFailure(() => env);

  const register = async (name, ownerKey) => {
    const result = await registerApp(
      env.clients[0].url,
      nodeKey(1),
      buildAppSpec({ name, ownerKey, description: `${name} by ${ownerKey.zelid}` }),
      'fluxappregister',
      { ownerKey },
    );
    expect(result.status, JSON.stringify(result)).to.equal('success');
    return result.data;
  };

  const heldEverywhere = async (hashes) => {
    const held = await Promise.all(env.clients.flatMap((c) => hashes
      .map((hash) => c.getTempMessages(hash).then((r) => r.status === 'success' && r.data?.length > 0).catch(() => false))));
    return held.every(Boolean);
  };

  const promotedEverywhere = async (hashes) => {
    const promoted = await Promise.all(env.clients.flatMap((c) => hashes.map((hash) => fetch(`${c.url}/apps/permanentmessages/${hash}`)
      .then((res) => res.json()).then((r) => r?.status === 'success' && r.data?.length > 0).catch(() => false))));
    return promoted.every(Boolean);
  };

  const ownerOn = async (index, name) => {
    const r = await env.clients[index].getAppSpecs(name).catch(() => null);
    return r?.status === 'success' ? r.data.owner : null;
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await bootAndPeer(env);
    await stopTicker();

    const sameAlice = await register(sameBlock, alice);
    const sameMallory = await register(sameBlock, mallory);
    const laterAlice = await register(laterBlock, alice);
    const laterMallory = await register(laterBlock, mallory);
    await waitFor(() => heldEverywhere([sameAlice, sameMallory, laterAlice, laterMallory]), {
      timeout: 60000, interval: 2000, label: 'all four registrations held by every node',
    });

    // One block: alice's registration, signed first, at position 0.
    await queueAppTx(sameAlice);
    await queueAppTx(sameMallory);
    // The other name: alice's registration confirmed a block before mallory's.
    await queueAppTx(laterAlice);
    await advanceBlock();
    await queueAppTx(laterMallory);
    await advanceBlock();
    await advanceBlocks(2);
    await startTicker();

    await waitFor(() => promotedEverywhere([sameAlice, sameMallory, laterAlice, laterMallory]), {
      timeout: 180000, interval: 3000, label: 'all four registrations promoted on every node',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('gives a name registered twice in one block to the registration earliest in the block, on every node', async () => {
    const owners = await Promise.all(env.clients.map((_, i) => ownerOn(i, sameBlock)));
    expect(owners).to.deep.equal(Array(NODES).fill(alice.zelid));
  });

  it('keeps a name with the owner confirmed first while its app is live, on every node', async () => {
    const owners = await Promise.all(env.clients.map((_, i) => ownerOn(i, laterBlock)));
    expect(owners).to.deep.equal(Array(NODES).fill(alice.zelid));
  });

  it('a node that restarts and rebuilds its registry gives both names to the same owner', async function () {
    this.timeout(420000);
    await restartFluxos(env.clients[RESTARTED].container);
    await waitFor(async () => (await ownerOn(RESTARTED, sameBlock)) !== null && (await ownerOn(RESTARTED, laterBlock)) !== null, {
      timeout: 360000, interval: 3000, label: 'the restarted node answering both apps again',
    });
    expect(await ownerOn(RESTARTED, sameBlock)).to.equal(alice.zelid);
    expect(await ownerOn(RESTARTED, laterBlock)).to.equal(alice.zelid);
  });
});
