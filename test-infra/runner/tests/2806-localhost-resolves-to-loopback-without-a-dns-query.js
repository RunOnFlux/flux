import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { dbClient } from '../framework/db-client.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dnsRecordsServed } from '../framework/external-http-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// `localhost` resolves to the loopback addresses without a DNS query, on a node whose DNS
// server does not answer it - as a public resolver does not, when a host lists one in
// resolv.conf.
//
// Node 1 is built with the direct-nameserver shape (test-infra/network-shapes.sh): its
// resolv.conf names the fleet's resolver itself. The resolver never answers `localhost` and
// counts every query for it. The node's policy source is its own API on `localhost`, fetched
// on every refresh through the main thread's global agent, and so through the lookup FluxOS
// installs there. Its API serves no policy file, so each fetch that reaches it ends in an
// HTTP answer the node logs; a fetch whose lookup failed would log the DNS error instead.
//
// A registration naming a registry host the resolver records shows the node's queries reach
// the resolver and are counted. Image verification needs the network policy, which the node
// takes from its peers since its own source serves none.

const NODES = 3;
const SHAPED = 0;
const API_PORT = 16127;
const REGISTRY_HOST = 'registry.e2e.test';
const FETCHES = 3;

describe('localhost resolves to loopback without a DNS query', function () {
  let env;

  dumpLogsOnFailure(() => env);

  const queriesFor = async (name) => {
    const served = (await dnsRecordsServed())[name]?.served ?? {};
    return (served.A ?? 0) + (served.AAAA ?? 0);
  };
  // A backstop fetch that reached an HTTP server: refused with a status, or answered with a
  // body that is not a signed bundle.
  const reachedLocalhost = /policyStore - (backstop fetch failed: Request failed with status code \d+|rejected bundle from backstop)/;

  // verifyappregistrationspecifications is a legacy req.on('data') handler: it reads the body
  // itself, so the spec goes as text/plain (see suite 64).
  const verifyRegistration = (spec) => env.clients[SHAPED].post(
    '/apps/verifyappregistrationspecifications',
    spec,
    { 'Content-Type': 'text/plain' },
  );

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      networkShapes: { [SHAPED]: 'direct-nameserver' },
      dnsRecords: [
        { name: 'localhost', records: { A: 'NO_REPLY', AAAA: 'NO_REPLY' } },
        { name: REGISTRY_HOST, records: { A: getSubnetConfig().externalStub } },
      ],
      nodeConfigOverrides: {
        [SHAPED]: { policy: { signedBaseUrl: `http://localhost:${API_PORT}`, refreshIntervalMs: 15000 } },
      },
      // The policy source serves no bundle.
      awaitPolicy: false,
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('sends the resolver its queries, which the resolver counts', async function () {
    // Canary for the zero count below: this node's queries for a recorded name are seen.
    this.timeout(210000);
    const db = dbClient(SHAPED + 1);
    await waitFor(async () => Boolean(await db.policyBundle()), {
      timeout: 120000, label: 'the shaped node to hold the bundle its peers hold',
    });
    const answer = await verifyRegistration({
      version: 8,
      name: `e2elocalhost${Date.now()}`,
      description: 'a registry host the resolver records',
      owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      compose: [{
        name: 'web',
        description: 'web',
        repotag: `${REGISTRY_HOST}/app:v1`,
        ports: [31806],
        containerPorts: [80],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerData: '/data',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        tiered: false,
        secrets: '',
        repoauth: '',
      }],
      instances: 3,
      contacts: [],
      geolocation: [],
      expire: 22000,
      nodes: [],
      staticip: false,
      enterprise: '',
    }).catch((error) => ({ requestError: error.message }));
    await waitFor(async () => (await queriesFor(REGISTRY_HOST)) > 0, {
      timeout: 30000,
      label: `the shaped node to ask the resolver for ${REGISTRY_HOST} (the registration was answered ${JSON.stringify(answer)})`,
    });
  });

  it(`reaches its own API at localhost on ${FETCHES} policy fetches without asking the resolver for localhost`, async function () {
    this.timeout(150000);
    await waitFor(async () => env.nodeLogCount(SHAPED, reachedLocalhost) >= FETCHES, {
      timeout: 120000, interval: 1000, label: `${FETCHES} policy fetches to reach localhost:${API_PORT}`,
    });
    expect(await queriesFor('localhost'), 'queries the resolver received for localhost').to.equal(0);
  });
});
