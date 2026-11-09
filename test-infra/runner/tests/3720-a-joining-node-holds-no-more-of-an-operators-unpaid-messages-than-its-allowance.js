/*
 * A joining node holds no more of one operator's unpaid messages than that
 * operator's allowance: each is admitted as it arrives, and what is held counts.
 *
 * JOINER boots cold, its chain unmoved, so its registry is not built and it checks
 * nothing it holds: the state of a node joining the network. Its one peer is an
 * Arcane stub whose link authenticates, and the stub answers JOINER's temp sync
 * with six messages admitted by OPERATOR_A and one by OPERATOR_B, each under a
 * client tag of its own so only the operator allowance (originKeyCap 3) decides
 * them. JOINER holds three of A's and B's one; the other three of A's are refused
 * as they arrive, naming the operator allowance. B's is the canary: another
 * operator is held while A is refused.
 *
 * Once a block builds the registry, what was held is checked and stored, and none
 * of what was refused is.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import {
  admittingSignature, currentTagHeight, freshClientTag, pendingMessage, pendingMessageOn,
} from '../framework/unpaid-messages.js';
import { advanceBlock } from '../framework/daemon-control.js';
import { dbClient } from '../framework/db-client.js';
import { nodeKey } from '../framework/keys.js';
import { waitFor, waitForDaemonReady } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const ANSWERING = 0;
const OPERATOR_B = 1;
const JOINER = 2;
// OPERATOR_A is the answering stub's own key.
const OPERATOR_A = ANSWERING;
const ORIGIN_KEY_CAP = 3;
const FROM_A = 6;
const OPERATOR_REFUSAL = `its admitting operator already has ${ORIGIN_KEY_CAP} unpaid app messages pending`;

describe('a joining node holds no more of an operator\'s unpaid messages than its allowance', function () {
  let env;
  let mark;
  const fromA = [];
  let fromB;
  const stamp = Date.now();

  dumpLogsOnFailure(() => env);

  // An unpaid message as `operator` admitted it, under a client tag of its own.
  async function admittedBy(app, operator, clientTagHeight) {
    const admitted = { clientTag: freshClientTag(), clientTagHeight };
    const origin = await admittingSignature(pendingMessage(app, admitted), nodeKey(operator + 1));
    return pendingMessage(app, { ...admitted, origin });
  }

  const admissionsOf = (client) => client.getEventBuffer()
    .filter((event) => event.id > mark && event.event === 'appmessage:admission')
    .map((event) => event.data);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      deferredNodes: 1,
      stubPeers: [ANSWERING, OPERATOR_B],
      arcaneStubPeers: [ANSWERING, OPERATOR_B],
      answeringSyncPeers: [ANSWERING],
      configOverrides: { fluxapps: { originKeyCap: ORIGIN_KEY_CAP } },
    });
    const clientTagHeight = await currentTagHeight();
    for (let i = 0; i < FROM_A; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      fromA.push(await buildSeedableApp({ env, name: `e2eheldcapa${i}x${stamp}`, instances: 1 }));
    }
    fromB = await buildSeedableApp({ env, name: `e2eheldcapb${stamp}`, instances: 1 });
    const answer = await Promise.all([
      ...fromA.map((app) => admittedBy(app, OPERATOR_A, clientTagHeight)),
      admittedBy(fromB, OPERATOR_B, clientTagHeight),
    ]);
    await env.stubPeerClients.get(ANSWERING).answerSyncWith({ fluxapptempsync: answer });

    const joiner = await env.startNode(JOINER);
    mark = joiner.getLastEventId();
    await waitForDaemonReady(joiner);
    await env.startDiscovery([JOINER]);
    await waitFor(
      async () => (await env.stubPeerClients.get(ANSWERING).getStats()).syncAnswersSent >= 4,
      { timeout: 240000, interval: 2000, label: 'JOINER asked the stub for all four streams, and it answered' },
    );
    await waitFor(
      async () => admissionsOf(joiner).filter((d) => [...fromA, fromB].some((app) => app.hash === d.hash)).length >= FROM_A + 1,
      { timeout: 60000, interval: 1000, label: 'JOINER decided on every message in the answer' },
    );
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('holds as many of one operator\'s messages as its allowance, and refuses the rest as they arrive', async function () {
    this.timeout(60000);
    const joiner = env.clients[JOINER];
    const held = await dbClient(joiner.num).heldMessageHashes();
    const decisions = admissionsOf(joiner).filter((d) => fromA.some((app) => app.hash === d.hash));

    expect(fromA.filter((app) => held.includes(app.hash)), `held: ${JSON.stringify(held)}`).to.have.length(ORIGIN_KEY_CAP);
    expect(decisions.filter((d) => d.taken), JSON.stringify(decisions)).to.have.length(ORIGIN_KEY_CAP);
    decisions.filter((d) => !d.taken).forEach((d) => expect(d.reason).to.equal(OPERATOR_REFUSAL));
    expect(decisions.filter((d) => !d.taken)).to.have.length(FROM_A - ORIGIN_KEY_CAP);
  });

  it('holds another operator\'s message beside them', async function () {
    this.timeout(60000);
    const held = await dbClient(env.clients[JOINER].num).heldMessageHashes();

    expect(held, JSON.stringify(held)).to.include(fromB.hash);
  });

  it('stores what it held once its registry is built, and nothing it refused', async function () {
    this.timeout(180000);
    const joiner = env.clients[JOINER];
    const takenA = fromA.filter((app) => admissionsOf(joiner).some((d) => d.hash === app.hash && d.taken));
    const refusedA = fromA.filter((app) => !takenA.includes(app));

    // A held message is checked once the registry is built, which a processed block starts.
    await advanceBlock();
    await waitFor(
      async () => (await Promise.all([...takenA, fromB].map((app) => pendingMessageOn(joiner, app.hash)))).every(Boolean),
      { timeout: 150000, interval: 2000, label: 'JOINER stored every message it held' },
    );

    const stored = await Promise.all(refusedA.map((app) => pendingMessageOn(joiner, app.hash)));
    expect(stored.filter(Boolean), 'refused and then stored').to.have.length(0);
    expect(await dbClient(joiner.num).heldMessageHashes(), 'left held').to.deep.equal([]);
  });
});
