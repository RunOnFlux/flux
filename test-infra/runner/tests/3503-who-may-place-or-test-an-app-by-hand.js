// weight: medium
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import {
  appOwnerKey, fluxTeamKey, nodeKey, userKey,
} from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { waitFor, waitForBootSettled } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An app registered and not yet paid for exists only as a temporary message.
// installapplocally places registered apps, for the flux team, and never one of
// these. testappinstall tries one out - installs it, checks it starts, tears it
// down, and never announces it - for its owner or the flux team, and refuses any
// other caller before a container is made.

const REAL_NODES = 2;
const NODE = 0;

describe('who may place or test an app by hand', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let appName;
  let messageHash;
  const client = () => env.clients[NODE];
  const authAs = async (key) => (await authenticate(client().url, key)).zelidauth;

  // Nothing of the app is left on the node, and no node holds a location for it there.
  async function assertNothingHeld() {
    expect(await dbClient(NODE + 1).localApp(appName), 'the app is installed on the node').to.equal(null);
    expect(await dbClient(NODE + 1).placements(), 'the node holds a placement record for the app').to.not.have.property(appName);
    const rows = await Promise.all(env.clients.map((_c, i) => dbClient(i + 1).appLocationAt(appName, socketAddr(NODE + 1))));
    expect(rows.filter(Boolean), 'a node holds a location for the app at the node').to.deep.equal([]);
  }

  before(async function () {
    this.timeout(420000);
    // Registration wants this many peers each way, and two nodes hold one.
    env = await createTestEnv({
      hookCtx: this,
      nodes: REAL_NODES,
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(env.clients.map((c) => waitForBootSettled(c, 240000)));

    appName = `e2ehandplaced${Date.now()}`;
    const spec = buildAppSpec({ name: appName });
    const result = await registerApp(client().url, nodeKey(1), spec);
    expect(result.status, `fixture: the registration was refused: ${JSON.stringify(result)}`).to.equal('success');
    messageHash = result.data;
    await waitFor(async () => (await client().getTempMessages(messageHash)).data?.length > 0, {
      timeout: 60000, interval: 2000, label: 'the node holds the temporary message',
    });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('refuses its owner placing it with installapplocally', async function () {
    this.timeout(120000);
    const body = await client().installAppLocally(messageHash, await authAs(appOwnerKey()));

    expect(body, 'the owner was not refused').to.match(/Unauthorized/);
    await assertNothingHeld();
  });

  it('does not place it for the flux team either', async function () {
    this.timeout(120000);
    const body = await client().installAppLocally(messageHash, await authAs(fluxTeamKey()));

    expect(body, 'installapplocally read the temporary message').to.match(new RegExp(`Application Specifications of ${messageHash} not found`));
    await assertNothingHeld();
  });

  it('refuses another user testing it', async function () {
    this.timeout(120000);
    const body = await client().testAppInstall(messageHash, await authAs(userKey()));

    expect(body, 'another user was not refused').to.match(/Unauthorized/);
    await assertNothingHeld();
  });

  it('lets its owner test it, and leaves nothing behind', async function () {
    this.timeout(300000);
    const body = await client().testAppInstall(messageHash, await authAs(appOwnerKey()));

    expect(body, 'the owner\'s test did not install the app').to.match(new RegExp(`Flux App ${appName} successfully installed and launched`));
    await waitFor(async () => (await dbClient(NODE + 1).localApp(appName)) === null, {
      timeout: 60000, interval: 2000, label: 'the test install is torn down',
    });
    await assertNothingHeld();
  });

  it('lets the flux team test it', async function () {
    this.timeout(300000);
    const body = await client().testAppInstall(messageHash, await authAs(fluxTeamKey()));

    expect(body, 'the flux team\'s test did not install the app').to.match(new RegExp(`Flux App ${appName} successfully installed and launched`));
    await waitFor(async () => (await dbClient(NODE + 1).localApp(appName)) === null, {
      timeout: 60000, interval: 2000, label: 'the test install is torn down',
    });
    await assertNothingHeld();
  });
});
