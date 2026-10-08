import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { restartFluxos } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { confirmTwoUpdatesInOneBlock } from '../framework/same-block-updates.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// When an owner's two updates to an app land in one block, every node holds the
// one the owner signed last, and so does a node that has just restarted and
// rebuilt its registry from the permanent messages. The update signed last sits
// first in the block and is promoted first, so position in the block or
// promotion order standing in for the owner's order shows.

const NODES = 4;
const RESTARTED = 1;

describe('an app\'s updates in one block leave every node holding the same spec', function () {
  let env;
  let outcome;
  const name = `e2esameblock${Date.now()}`;

  dumpLogsOnFailure(() => env);

  const heldBy = async (index) => {
    const r = await env.clients[index].getAppSpecs(name);
    expect(r.status, JSON.stringify(r)).to.equal('success');
    return r.data.description;
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await bootAndPeer(env);
    outcome = await confirmTwoUpdatesInOneBlock(env, name);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('every node holds the update signed last, though it sits first in the block', async () => {
    const held = [];
    for (let i = 0; i < NODES; i += 1) held.push(await heldBy(i)); // eslint-disable-line no-await-in-loop
    expect(held).to.deep.equal(Array(NODES).fill(outcome.standing.description));
  });

  it('every node holds exactly one registry row for the app', async () => {
    const rows = await Promise.all(Array.from({ length: NODES }, (_, i) => dbClient(i + 1).appSpecRows(name)));
    expect(rows.map((r) => r.length)).to.deep.equal(Array(NODES).fill(1));
  });

  it('a node that restarts and rebuilds its registry still holds it', async function () {
    this.timeout(420000);
    await restartFluxos(env.clients[RESTARTED].container);
    await waitFor(async () => {
      const r = await env.clients[RESTARTED].getAppSpecs(name).catch(() => null);
      return r?.status === 'success';
    }, { timeout: 360000, interval: 3000, label: 'the restarted node answering the app again' });
    expect(await heldBy(RESTARTED)).to.equal(outcome.standing.description);
    expect((await dbClient(RESTARTED + 1).appSpecRows(name)).length).to.equal(1);
  });
});
