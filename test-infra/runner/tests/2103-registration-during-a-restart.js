import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { restartFluxos } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An app confirmed while a node is restarting reaches that node's registry
// exactly once, beside every app it already held.
//
// The node promotes the new app during the stretch its boot hash sync and
// registry rebuild run in. Which of the two lands first is not something a
// fleet can choose, so this asserts the end state on a real node: nothing
// lost, nothing doubled. The exact interleaving - a write made while the
// rebuild's staging copy is being built - is proven by the unit suite
// registryRebuild.test.js, which can place the write inside that window.

const NODES = 4;
const RESTARTED = 0;
const EARLIER_APPS = 2;

describe('an app confirmed while a node restarts reaches its registry exactly once', function () {
  let env;
  const earlier = [];
  let arriving;

  dumpLogsOnFailure(() => env);

  const namesHeld = async () => {
    const res = await fetch(`${env.clients[RESTARTED].url}/apps/globalappsspecifications`);
    const body = await res.json().catch(() => null);
    return res.status === 200 && body?.status === 'success' ? body.data.map((a) => a.name) : null;
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await bootAndPeer(env);
    for (let i = 0; i < EARLIER_APPS; i += 1) {
      const name = `e2eduringrestart${i}${Date.now()}`;
      // eslint-disable-next-line no-await-in-loop
      const result = await registerAndConfirm(env.clients[1].url, nodeKey(2), buildAppSpec({ name }), env.clients);
      expect(result.status, JSON.stringify(result)).to.equal('success');
      earlier.push(name);
    }
    await waitFor(async () => {
      const held = await namesHeld();
      return held && earlier.every((n) => held.includes(n));
    }, { timeout: 180000, interval: 3000, label: 'the earlier apps in the restarting node\'s registry' });

    // Restart the node and confirm a new app through the others while it boots.
    arriving = `e2earrived${Date.now()}`;
    const restarting = restartFluxos(env.clients[RESTARTED].container);
    const others = env.clients.filter((_, i) => i !== RESTARTED);
    const result = await registerAndConfirm(env.clients[1].url, nodeKey(2), buildAppSpec({ name: arriving }), others);
    expect(result.status, JSON.stringify(result)).to.equal('success');
    await restarting;
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('holds the new app and every earlier one', async function () {
    this.timeout(420000);
    await waitFor(async () => {
      const held = await namesHeld();
      return held && [...earlier, arriving].every((n) => held.includes(n));
    }, { timeout: 360000, interval: 3000, label: 'every app in the restarted node\'s registry' });
  });

  it('holds exactly one row for each of them', async () => {
    const db = dbClient(RESTARTED + 1);
    const counts = await Promise.all([...earlier, arriving].map(async (n) => (await db.appSpecRows(n)).length));
    expect(counts).to.deep.equal([1, 1, 1]);
  });
});
