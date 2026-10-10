import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dnsRecordsServed } from '../framework/external-http-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A name a node's own DNS server answers does not exist (NXDOMAIN) for one record type does
// not exist for any: the lookup fails with ENOTFOUND, whatever the server did with the other
// type's query, and the public servers are not asked.
//
// Anyone can make a node look such a name up: /apps/verifyappregistrationspecifications
// needs no authentication and resolves the registry host in the spec's repotag. The suite
// does exactly that, once for a registry host whose AAAA query goes unanswered and once for
// one whose AAAA query is answered SERVFAIL; both A queries are answered NXDOMAIN.
//
// Node 1 is built with the public-dns-counted shape (test-infra/network-shapes.sh): its own
// DNS server is the fleet's resolver, as on every node, and the public servers FluxOS asks
// next reach the same resolver on another port, so each query is counted by the route it
// took. The node holds a global IPv6 address (createTestEnv globalIpv6), so a lookup asks for
// both record types.

const NX_UNANSWERED = 'nx-aaaa-unanswered.e2e.test';
const NX_SERVFAIL = 'nx-aaaa-servfail.e2e.test';
const NODES = 3;
const SHAPED = 0;

describe('a name its own DNS server says does not exist ends a node\'s lookup there', function () {
  let env;

  dumpLogsOnFailure(() => env);

  const via = async (name) => (await dnsRecordsServed())[name]?.via ?? {};

  // verifyappregistrationspecifications is a legacy req.on('data') handler: it reads the body
  // itself, so the spec goes as text/plain (see suite 64).
  const verifyRegistration = (registryHost, port) => env.clients[SHAPED].post(
    '/apps/verifyappregistrationspecifications',
    {
      version: 8,
      name: `e2enxname${Date.now()}`,
      description: 'a registry host its DNS server says does not exist',
      owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      compose: [{
        name: 'web',
        description: 'web',
        repotag: `${registryHost}/app:v1`,
        ports: [port],
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
    },
    { 'Content-Type': 'text/plain' },
  ).catch((error) => ({ requestError: error.message }));

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      networkShapes: { [SHAPED]: 'public-dns-counted' },
      globalIpv6: [SHAPED],
      dnsRecords: [
        { name: NX_UNANSWERED, records: { A: 'NXDOMAIN', AAAA: 'NO_REPLY' } },
        { name: NX_SERVFAIL, records: { A: 'NXDOMAIN', AAAA: 'SERVFAIL' } },
      ],
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  [
    { host: NX_UNANSWERED, aaaa: 'unanswered', port: 31811 },
    { host: NX_SERVFAIL, aaaa: 'answered SERVFAIL', port: 31812 },
  ].forEach(({ host, aaaa, port }) => {
    it(`fails a registration naming a host whose A query is answered NXDOMAIN and AAAA query ${aaaa} with ENOTFOUND, without the public servers`, async function () {
      this.timeout(90000);
      const answer = JSON.stringify(await verifyRegistration(host, port));
      // The condition under test, shown present: the node asked its own server for both types.
      await waitFor(async () => {
        const counts = (await via(host)).own ?? {};
        return (counts.A ?? 0) > 0 && (counts.AAAA ?? 0) > 0;
      }, { timeout: 30000, label: `the shaped node to ask its own server for ${host} A and AAAA` });
      expect(answer).to.include(`ENOTFOUND: ${host}`);
      expect((await via(host)).public ?? {}, `queries for ${host} to the public servers`).to.deep.equal({});
    });
  });
});
