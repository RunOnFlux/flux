/*
 * A node that verifies the messages it fetched in bulk for longer than a peer connection may sit
 * idle still keeps every one of them.
 *
 * The joiner is missing 600 messages, which every peer serves. Its verification is held at
 * hashSync:beforeVerify for 150 s - longer than the 120 s a bulk fetch lets a peer connection go
 * without data in production - and then released. Fetching is over before verifying starts, so
 * no connection is open while it waits: the first peer asked delivers everything, and the joiner
 * keeps every message at its own record's txid, height and payment.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { waitForOrchestratorState } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { fleetMissingALog, startJoiner, messagesNotKept } from '../framework/message-log.js';

// Production's hashSyncBulkIdleMs, which the hold must outlast.
const PRODUCTION_IDLE_MS = 120000;
const HOLD_MS = 150000;

describe('a node that verifies for longer than a peer connection may sit idle loses nothing', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let log;
  let joiner;
  let held;
  let heldFor;
  let stagedWhileHeld;
  let bulkFetched;

  before(async function () {
    this.timeout(1200000);
    ({ env, log, joiner } = await fleetMissingALog(this, { name: 'e2eSlowVerify' }));

    const client = await startJoiner(env, joiner);
    await client.holdCheckpoint('hashSync:beforeVerify');
    await env.startDiscovery([joiner]);

    held = await client.waitForEvent('checkpoint:held', (d) => d.name === 'hashSync:beforeVerify', 600000);
    stagedWhileHeld = (await dbClient(joiner + 1).collectionNames('appsGlobal')).includes('zelappsmessagesstaging');
    const heldAt = Date.now();
    await new Promise((resolve) => { setTimeout(resolve, HOLD_MS); });
    await client.releaseCheckpoint('hashSync:beforeVerify');
    heldFor = Date.now() - heldAt;

    bulkFetched = await client.waitForEvent('hashSync:bulkFetched', (d) => d.processed > 0, 300000);
    await waitForOrchestratorState(client, 'READY', 600000);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('held verification for longer than a peer connection may sit idle', function () {
    expect(held, 'verification reached its checkpoint').to.exist;
    expect(heldFor).to.be.above(PRODUCTION_IDLE_MS);
  });

  it('took every missing message from the first peer it asked, with nothing cut short', function () {
    const { peers, processed } = bulkFetched.data;
    expect(peers, JSON.stringify(peers)).to.have.lengthOf(1);
    expect(peers[0].error, JSON.stringify(peers[0])).to.equal(undefined);
    expect(peers[0].staged).to.equal(log.length);
    expect(processed).to.equal(log.length);
  });

  it('keeps every message, each at its own record\'s txid, height and payment', async function () {
    expect(await messagesNotKept(joiner, log)).to.deep.equal([]);
  });

  it('leaves no staged messages behind', async function () {
    expect(stagedWhileHeld, 'a stage while verification was held').to.equal(true);
    expect(await dbClient(joiner + 1).collectionNames('appsGlobal')).to.not.include('zelappsmessagesstaging');
  });
});
