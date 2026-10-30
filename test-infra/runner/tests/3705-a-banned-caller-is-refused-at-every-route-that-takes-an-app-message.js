/*
 * A caller the network blocklist bans is refused at every route that takes or
 * prepares an app message, on every node, and only while its entry is in force.
 *
 * The fleet trusts its gateway as a balancer, so the runner names each caller with
 * x-forwarded-for, as a balancer does. The published blocklist carries a `client`
 * entry for one caller. Every node adopts it; that caller is then answered 403 by
 * the submission routes, and its registration is refused, while another caller
 * registers through the same node. An entry whose expiry has passed, and an entry
 * removed from the list, refuse nothing.
 *
 * Every node polls the published source every few seconds: the subject is what a
 * node does with a ban it holds, not how the ban reaches it.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { appOwnerKey, nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerApp } from '../framework/app-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { setBlocklist } from '../framework/external-http-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODES = 3;
const ENTRIES = [1, 2];
const BANNED = '198.51.100.91';
const OTHER = '198.51.100.92';

const SUBMISSION_POSTS = [
  '/apps/verifyappregistrationspecifications',
  '/apps/verifyappupdatespecifications',
  '/apps/calculateprice',
  '/apps/calculatefiatandfluxprice',
  '/apps/checkdockerexistance',
  '/apps/getpublickey',
];

const dayOffset = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

describe('a banned caller is refused at every route that takes an app message', function () {
  let env;
  const owner = appOwnerKey();
  const stamp = Date.now();
  let registrations = 0;

  dumpLogsOnFailure(() => env);

  const ban = (fields) => ({
    kind: 'client', value: `${BANNED}/32`, reason: 'suite 3705', added: dayOffset(-30), expires: dayOffset(30), ...fields,
  });

  // Publishes a blocklist and waits until every node has adopted the sequence it was published as.
  const publish = async (entries) => {
    const marks = env.clients.map((c) => c.getLastEventId());
    const { seq } = await setBlocklist(entries);
    expect(seq, 'the publish returned a sequence to converge on').to.be.a('number');
    await Promise.all(env.clients.map((c, i) => c.waitForEvent('policy:bundleChanged', (d) => d.seq >= seq, 60000, { afterId: marks[i] })));
  };

  const register = (entry, caller) => {
    registrations += 1;
    return registerApp(
      env.clients[entry].url,
      nodeKey(entry + 1),
      buildAppSpec({ name: `e2eban${registrations}x${stamp}`, ownerKey: owner }),
      'fluxappregister',
      { ownerKey: owner, headers: { 'x-forwarded-for': caller } },
    );
  };

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      configOverrides: { fdmAddresses: [getSubnetConfig().gateway], policy: { refreshIntervalMs: 5000 } },
    });
    await bootAndPeer(env);
    await publish([ban()]);
  });

  after(async function () {
    this.timeout(60000);
    await setBlocklist([]).catch(() => {});
    await env?.teardown();
  });

  it('answers the banned caller 403 at every submission route, on every node', async function () {
    this.timeout(120000);
    const asked = ENTRIES.flatMap((entry) => [
      ...SUBMISSION_POSTS.map((path) => ({ entry, method: 'POST', path })),
      { entry, method: 'GET', path: '/apps/testappinstall/anyapp' },
    ]);
    const answers = await Promise.all(asked.map(async ({ entry, method, path }) => {
      const options = method === 'POST'
        ? { body: {}, headers: { 'Content-Type': 'text/plain', 'x-forwarded-for': BANNED } }
        : { headers: { 'x-forwarded-for': BANNED } };
      const response = await env.clients[entry].request(method, path, options);
      return {
        entry, path, status: response.status, message: response.data?.data?.message,
      };
    }));

    expect(answers).to.have.lengthOf(ENTRIES.length * (SUBMISSION_POSTS.length + 1));
    answers.forEach((answer) => {
      expect(answer, JSON.stringify(answer)).to.include({ status: 403, message: 'App messages from this address are not accepted' });
    });
  });

  it('refuses the banned caller\'s registration and takes another caller\'s through the same node', async function () {
    this.timeout(180000);
    const refused = await register(ENTRIES[0], BANNED);
    expect(refused.status, JSON.stringify(refused)).to.equal('error');
    expect(refused.data.message).to.equal('App messages from this address are not accepted');

    const taken = await register(ENTRIES[0], OTHER);
    expect(taken.status, JSON.stringify(taken)).to.equal('success');
  });

  it('refuses nothing once the entry has expired', async function () {
    this.timeout(180000);
    await publish([ban({ added: dayOffset(-60), expires: dayOffset(-1) })]);

    const taken = await register(ENTRIES[1], BANNED);
    expect(taken.status, JSON.stringify(taken)).to.equal('success');
  });

  it('refuses nothing once the entry is removed', async function () {
    this.timeout(180000);
    await publish([ban()]);
    const refused = await register(ENTRIES[1], BANNED);
    expect(refused.status, 'the ban was in force again before its removal').to.equal('error');

    await publish([]);
    const taken = await register(ENTRIES[1], BANNED);
    expect(taken.status, JSON.stringify(taken)).to.equal('success');
  });
});
