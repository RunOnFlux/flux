/*
 * The network policy sets the unpaid-message allowances, and grants a submitter
 * range a client cap of its own.
 *
 * The fleet boots on a bundle whose `unpaidallowances` document holds a client to
 * 2 and lists one submitter address with a cap of 4; no node's config sets a cap,
 * so the release defaults (20 and 100) would let every registration here through.
 * The runner registers through the real nodes' doors, naming its caller with
 * x-forwarded-for: each node trusts the fleet gateway as a balancer.
 *
 * An unlisted client is held to 2. The submitter is held to 4 whichever node it
 * registers through, and every node stores its messages under that cap: each
 * counts them against the cap the admitting node wrote, not its own. A message
 * relayed with a cap above the largest the policy grants is refused; the same
 * relay with the listed cap is taken, so the refusal is the cap's.
 *
 * The ticker is stopped and the chain is moved to the start of a tag epoch
 * first, so no client's tag changes mid-test.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { appOwnerKey, nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { stopTicker } from '../framework/daemon-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import {
  startTagEpoch, currentTagHeight, freshClientTag, pendingMessage, admittingSignature, admissionOf, pendingMessageOn,
} from '../framework/unpaid-messages.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const NODES = 4;
const STUB = 3;
// Never index 0: every backward arc wraps onto it.
const ENTRIES = [1, 2];
const OBSERVER = 1;
const ADMITTER = 2;

const CLIENT_TAG_CAP = 2;
const SUBMITTER_CAP = 4;
const ORIGIN_KEY_CAP = 8;

// RFC 5737 documentation addresses.
const CLIENT = '198.51.100.81';
const SUBMITTER = '198.51.100.82';

const day = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

describe('the network policy sets the unpaid allowances, and grants a submitter range its own', function () {
  let env;
  let stub;
  const owner = appOwnerKey();
  const stamp = Date.now();

  dumpLogsOnFailure(() => env);

  const register = (entry, caller, label) => registerApp(
    env.clients[entry].url,
    nodeKey(entry + 1),
    buildAppSpec({ name: `e2epolicy${label}${stamp}`, ownerKey: owner }),
    'fluxappregister',
    { ownerKey: owner, headers: { 'x-forwarded-for': caller } },
  );

  const realClients = () => env.clients.filter((_, i) => i !== STUB);

  const heldEverywhere = (hash) => waitFor(async () => {
    const held = await Promise.all(realClients().map((c) => pendingMessageOn(c, hash)));
    return held.every((doc) => doc !== null);
  }, { timeout: 60000, interval: 2000, label: `${hash} held by every node` });

  let appCount = 0;
  const relayedWithCap = async (clientTagCap) => {
    appCount += 1;
    const app = await buildSeedableApp({ env, name: `e2epolicyrelay${appCount}x${stamp}`, instances: 1 });
    const admitted = { clientTag: freshClientTag(), clientTagHeight: await currentTagHeight(), clientTagCap };
    const origin = await admittingSignature(pendingMessage(app, admitted), nodeKey(ADMITTER + 1));
    const mark = env.clients[OBSERVER].getLastEventId();
    await stub.broadcast(pendingMessage(app, { ...admitted, origin }));
    return admissionOf(env.clients[OBSERVER], app.hash, mark);
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      stubPeers: [STUB],
      // Relays as an Arcane peer, over links it has authenticated.
      arcaneStubPeers: [STUB],
      tickerAutostart: false,
      configOverrides: { fdmAddresses: [getSubnetConfig().gateway] },
      policy: {
        documents: {
          unpaidallowances: {
            clientTagCap: CLIENT_TAG_CAP,
            originKeyCap: ORIGIN_KEY_CAP,
            submitters: [{
              value: `${SUBMITTER}/32`, cap: SUBMITTER_CAP, reason: 'submits for many clients', added: day(0), expires: day(30),
            }],
          },
        },
      },
    });
    await bootAndPeer(env);
    stub = env.stubPeerClients.get(STUB);
    await waitFor(async () => (await stub.connectedNodes()) >= NODES - 1, {
      timeout: 120000, interval: 2000, label: 'every real node connected to the stub peer',
    });
    await stopTicker();
    await startTagEpoch(realClients());
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('holds an unlisted client to the policy\'s client cap, not the release default', async function () {
    this.timeout(180000);
    const first = await register(ENTRIES[0], CLIENT, 'c1');
    const second = await register(ENTRIES[1], CLIENT, 'c2');
    expect(first.status, JSON.stringify(first)).to.equal('success');
    expect(second.status, JSON.stringify(second)).to.equal('success');
    await heldEverywhere(first.data);
    await heldEverywhere(second.data);

    const third = await register(ENTRIES[0], CLIENT, 'c3');

    expect(third.status, JSON.stringify(third)).to.equal('error');
    expect(third.data.message).to.include(`its client already has ${CLIENT_TAG_CAP} unpaid app messages pending`);
  });

  it('holds a listed submitter to its range\'s cap, on every node, whichever node it registers through', async function () {
    this.timeout(300000);
    const taken = [];
    for (let i = 0; i < SUBMITTER_CAP; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await register(ENTRIES[i % ENTRIES.length], SUBMITTER, `s${i}`);
      expect(result.status, `registration ${i}: ${JSON.stringify(result)}`).to.equal('success');
      // eslint-disable-next-line no-await-in-loop
      await heldEverywhere(result.data);
      taken.push(result.data);
    }

    const caps = await Promise.all(taken.flatMap((hash) => realClients().map((c) => pendingMessageOn(c, hash).then((doc) => doc.clientTagCap))));
    expect(caps, 'the cap each node stored beside the submitter\'s messages').to.deep.equal(caps.map(() => SUBMITTER_CAP));

    const over = await register(ENTRIES[1], SUBMITTER, 'sover');
    expect(over.status, JSON.stringify(over)).to.equal('error');
    expect(over.data.message).to.include(`its client already has ${SUBMITTER_CAP} unpaid app messages pending`);
  });

  it('refuses a relayed message claiming a cap above the largest the policy grants, and takes one with the listed cap', async function () {
    this.timeout(180000);
    const above = await relayedWithCap(SUBMITTER_CAP + 1);
    expect(above.taken, JSON.stringify(above)).to.equal(false);
    expect(above.reason).to.equal(`its client cap ${SUBMITTER_CAP + 1} is above the largest the network policy grants (${SUBMITTER_CAP})`);

    const listed = await relayedWithCap(SUBMITTER_CAP);
    expect(listed, JSON.stringify(listed)).to.include({ taken: true, originKey: nodeKey(ADMITTER + 1).pubkey });
  });
});
