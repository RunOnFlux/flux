import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { dnsRecordsServed } from '../framework/external-http-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// An IPv6 address that carries an IPv4 address reaches that IPv4 address: through a NAT64
// translator (64:ff9b::/96) or a 6to4 relay (2002::/16). FluxOS refuses to fetch an image
// from a registry whose address carries a private or reserved IPv4 address, as it refuses the
// IPv4 address itself, and fetches from one whose address carries a public IPv4 address.
//
// Anyone can make a node look a registry up: /apps/verifyappregistrationspecifications needs
// no authentication and checks the image named in the spec's repotag. The suite sends one
// registration per registry host. Each host's AAAA record is the address under test; its A
// query is answered SERVFAIL, so the node's lookup answers with the IPv6 address alone. The
// node holds a global IPv6 address (createTestEnv globalIpv6), so a lookup asks for AAAA.

const NODES = 3;
const SHAPED = 0;

const REGISTRIES = [
  { host: 'nat64-metadata.e2e.test', aaaa: '64:ff9b::a9fe:a9fe', carries: '169.254.169.254', refused: true },
  { host: 'nat64-private.e2e.test', aaaa: '64:ff9b::a00:1', carries: '10.0.0.1', refused: true },
  { host: 'sixtofour-private.e2e.test', aaaa: '2002:a00:1::1', carries: '10.0.0.1', refused: true },
  { host: 'nat64-public.e2e.test', aaaa: '64:ff9b::808:808', carries: '8.8.8.8', refused: false },
];

const REFUSAL = 'points at a private or reserved address';

describe('a registry at an IPv6 address carrying a private IPv4 address is refused', function () {
  let env;

  dumpLogsOnFailure(() => env);

  const servedAAAA = async (host) => (await dnsRecordsServed())[host]?.served?.AAAA ?? 0;

  // verifyappregistrationspecifications is a legacy req.on('data') handler: it reads the body
  // itself, so the spec goes as text/plain (see suite 64).
  const verifyRegistration = (registryHost, port) => env.clients[SHAPED].post(
    '/apps/verifyappregistrationspecifications',
    {
      version: 8,
      name: `e2ecarrier${Date.now()}`,
      description: 'a registry at an IPv6 address carrying an IPv4 address',
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
      globalIpv6: [SHAPED],
      dnsRecords: REGISTRIES.map(({ host, aaaa }) => ({ name: host, records: { A: 'SERVFAIL', AAAA: aaaa } })),
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  REGISTRIES.forEach(({
    host, aaaa, carries, refused,
  }, index) => {
    it(`${refused ? 'refuses' : 'does not refuse'} a registry at ${aaaa}, which carries ${carries}`, async function () {
      this.timeout(120000);
      const answer = JSON.stringify(await verifyRegistration(host, 31821 + index));
      // The condition under test, shown present: the node looked the registry's IPv6 address up.
      await waitFor(async () => (await servedAAAA(host)) > 0, {
        timeout: 30000, label: `the shaped node to ask for ${host}'s AAAA record`,
      });
      if (refused) expect(answer).to.include(`${host}/app:v1 ${REFUSAL}`);
      else expect(answer).to.not.include(REFUSAL);
    });
  });
});
