/*
 * A node whose FluxOS restarts while it holds fetched messages it has not verified fetches them
 * again and keeps every one, and nothing staged outlives the run that staged it.
 *
 * The joiner fetches the 600 messages it is missing and is held at hashSync:beforeVerify, with
 * all of them staged. Its FluxOS restarts there. The run after the restart opens its own stage,
 * empty, takes the messages from a peer again and verifies them; the stage is gone once it is
 * done.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { waitFor, waitForOrchestratorState } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { fleetMissingALog, startJoiner, messagesNotKept } from '../framework/message-log.js';

const STAGE = 'zelappsmessagesstaging';

describe('a node restarted while verifying fetched messages fetches them again', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let log;
  let joiner;
  let stagedWhileHeld;
  let keptWhileHeld;

  before(async function () {
    this.timeout(1800000);
    ({ env, log, joiner } = await fleetMissingALog(this, { name: 'e2eRestartVerify' }));

    const client = await startJoiner(env, joiner);
    await client.holdCheckpoint('hashSync:beforeVerify');
    await env.startDiscovery([joiner]);
    await client.waitForEvent('checkpoint:held', (d) => d.name === 'hashSync:beforeVerify', 600000);

    const db = dbClient(joiner + 1);
    stagedWhileHeld = (await db.collectionNames('appsGlobal')).includes(STAGE);
    keptWhileHeld = log.length - (await messagesNotKept(joiner, log)).length;

    await env.restartNode(joiner, { timeout: 120000 });

    await waitFor(async () => (await messagesNotKept(joiner, log)).length === 0, {
      timeout: 900000, interval: 5000, label: 'every message kept after the restart',
    });
    await waitForOrchestratorState(env.clients[joiner], 'READY', 600000);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('held the fetched messages staged, and none of them kept, when it restarted', function () {
    expect(stagedWhileHeld, 'a stage while held').to.equal(true);
    expect(keptWhileHeld, 'messages kept while held').to.equal(0);
  });

  it('keeps every message after the restart, each at its own record\'s txid, height and payment', async function () {
    const notKept = await messagesNotKept(joiner, log);
    expect(notKept, JSON.stringify(notKept)).to.deep.equal([]);
  });

  it('leaves no staged messages behind', async function () {
    expect(await dbClient(joiner + 1).collectionNames('appsGlobal')).to.not.include(STAGE);
  });
});
