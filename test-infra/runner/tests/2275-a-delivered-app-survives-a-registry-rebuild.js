import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { deliverApp } from '../framework/app-delivery.js';
import { dbClient } from '../framework/db-client.js';
import { waitFor } from '../framework/wait.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A registry rebuild builds a fresh copy of the app registry from the message log
// and swaps it in. An app delivered while a rebuild has built its copy and not yet
// swapped it is in the registry once the rebuild ends: the node stores the app's
// specification through the registry's lock, which the rebuild holds.

const NODE = 0;
const BEFORE_SWAP = 'registry:beforeSwap';

describe('a delivered app survives a registry rebuild', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const node = () => env.clients[NODE];

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 2 });
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(60000);
    await node()?.releaseAllCheckpoints().catch(() => {});
    await env?.teardown();
  });

  it('holds an app delivered while a rebuild is about to swap the registry', async function () {
    this.timeout(300000);
    const app = await buildSeedableApp({ env, name: `e2erebuild${Date.now()}` });
    const db = dbClient(NODE + 1);

    const from = node().getLastEventId();
    await node().holdCheckpoint(BEFORE_SWAP);
    const auth = await authenticate(node().url, fluxTeamKey());
    const rebuild = node().getAuthed('/apps/reindexglobalappsinformation', auth.zelidauth);
    await node().waitForEvent('checkpoint:held', (d) => d.name === BEFORE_SWAP, 120000, { afterId: from });

    let failed = null;
    const delivery = deliverApp(env, app, [NODE]).catch((error) => { failed = error; });
    // The message is stored just before the specification, so the specification's
    // write is waiting on the rebuild from here.
    await waitFor(async () => {
      if (failed) throw failed;
      return (await db.permanentMessages({ hash: app.hash })).length === 1;
    }, {
      timeout: 60000, interval: 1000, label: 'the node stored the delivered message during the rebuild',
    });
    expect((await db.globalAppSpec(app.spec.name))?.hash ?? null, 'the specification is written once the rebuild ends').to.equal(null);

    await node().releaseCheckpoint(BEFORE_SWAP);
    expect((await rebuild)?.status, 'the rebuild ran').to.equal('success');
    await delivery;
    if (failed) throw failed;
    expect((await db.globalAppSpec(app.spec.name))?.hash, 'the registry holds the delivered app').to.equal(app.hash);
  });
});
