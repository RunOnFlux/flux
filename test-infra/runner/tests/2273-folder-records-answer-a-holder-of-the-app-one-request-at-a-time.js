/*
 * A node answers /apps/folderrecords only for a node that holds the folder's app, as it
 * does, and one request from that node at a time.
 *
 * Nodes 1 and 2 hold app A; node 0 holds nothing; node 2 also holds app B, which node 1
 * does not. Every request is signed with a node's key and sent from inside a node's
 * container, so the asked node sees the source IP it would see in production. Each
 * refusal is built with the other conditions met: node 0's key is a node's key, the
 * request from node 0 names an address that holds A, and B's folder is asked about by
 * a holder of B.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { signedNodeBody, postFromNode } from '../framework/signed-node-request.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const BEFORE_READ = 'folderRecords:beforeRead';

describe('folder records answer a holder of the app, one request at a time', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const stamp = Date.now();
  const appA = `e2erecordsa${stamp}`;
  const appB = `e2erecordsb${stamp}`;
  const folderOf = (name) => `flux${name}_${name}`;
  const ASKED = 1;
  const HOLDER = 2;
  const STRANGER = 0;
  const client = (i) => env.clients[i];
  const address = (i) => `${client(i).ip}:16127`;
  const url = () => `http://${address(ASKED)}/apps/folderrecords`;
  // node i's key is node number i + 1's
  const ask = async ({ sentFrom, signedBy, from, folder }) => postFromNode(
    client(sentFrom).container,
    url(),
    await signedNodeBody(signedBy + 1, address(ASKED), { folder, items: ['placed.txt'], from: address(from) }),
  );
  const expectRefused = (answer) => {
    expect(answer.status, JSON.stringify(answer)).to.equal('error');
    expect(answer.data?.name, JSON.stringify(answer)).to.equal('Unauthorized');
  };
  const component = (name) => ({
    name,
    description: 'a component with a synced folder',
    repotag: `${REGISTRY_REPO_HOST}/${name}:v1`,
    ports: [],
    domains: [''],
    environmentParameters: [],
    commands: [],
    containerPorts: [80],
    containerData: 's:/appdata',
    cpu: 0.1,
    ram: 100,
    hdd: 1,
    repoauth: '',
  });
  const listedAt = async (name, i) => ((await client(ASKED).getAppLocations(name)).data ?? [])
    .some((row) => String(row.ip).split(':')[0] === client(i).ip);

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: 3 });
    await bootAndPeer(env);

    await Promise.all([appA, appB].map((name) => pushTestApp(name, 'v1', name, { user: 1000 })));
    await installOnNodes(env, await buildSeedableApp({ env, name: appA, instances: 2, compose: [component(appA)] }), [ASKED, HOLDER]);
    await installOnNodes(env, await buildSeedableApp({ env, name: appB, instances: 1, compose: [component(appB)] }), [HOLDER]);
    await waitFor(async () => (await listedAt(appA, HOLDER)) && (await listedAt(appB, HOLDER)), {
      timeout: 300000, interval: 3000, label: `node ${ASKED} lists node ${HOLDER} holding both apps`,
    });
    expect(await listedAt(appA, STRANGER), 'fixture: the stranger holds app A').to.equal(false);
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('answers a node that holds the app', async function () {
    this.timeout(120000);
    const answer = await ask({ sentFrom: HOLDER, signedBy: HOLDER, from: HOLDER, folder: folderOf(appA) });

    expect(answer.status, JSON.stringify(answer)).to.equal('success');
    expect(answer.data.folder).to.equal(folderOf(appA));
  });

  it('refuses a node that does not hold the app', async function () {
    this.timeout(120000);
    expectRefused(await ask({ sentFrom: STRANGER, signedBy: STRANGER, from: STRANGER, folder: folderOf(appA) }));
  });

  it('refuses a request from another IP than the address it names', async function () {
    this.timeout(120000);
    expectRefused(await ask({ sentFrom: STRANGER, signedBy: HOLDER, from: HOLDER, folder: folderOf(appA) }));
  });

  it('refuses a key that does not own the node at the address it names', async function () {
    this.timeout(120000);
    expectRefused(await ask({ sentFrom: HOLDER, signedBy: STRANGER, from: HOLDER, folder: folderOf(appA) }));
  });

  it('refuses a holder asking about an app the asked node does not hold', async function () {
    this.timeout(120000);
    expectRefused(await ask({ sentFrom: HOLDER, signedBy: HOLDER, from: HOLDER, folder: folderOf(appB) }));
  });

  it('answers one request from a node at a time', async function () {
    this.timeout(180000);
    await client(ASKED).holdCheckpoint(BEFORE_READ, folderOf(appA));
    const mark = client(ASKED).getLastEventId();
    const first = ask({ sentFrom: HOLDER, signedBy: HOLDER, from: HOLDER, folder: folderOf(appA) });
    try {
      await client(ASKED).waitForEvent(
        'checkpoint:held',
        (d) => d.name === BEFORE_READ && d.key === folderOf(appA),
        60000,
        { afterId: mark },
      );
      const second = await ask({ sentFrom: HOLDER, signedBy: HOLDER, from: HOLDER, folder: folderOf(appA) });
      expect(second.status, JSON.stringify(second)).to.equal('error');
      expect(second.data?.name, JSON.stringify(second)).to.equal('TooManyRequests');
    } finally {
      await client(ASKED).releaseCheckpoint(BEFORE_READ, folderOf(appA));
    }
    const answered = await first;
    expect(answered.status, JSON.stringify(answered)).to.equal('success');
  });
});
