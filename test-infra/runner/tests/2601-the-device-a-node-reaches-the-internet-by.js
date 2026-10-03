import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { fluxTeamKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { dbClient } from '../framework/db-client.js';
import { waitForDaemonReady, waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A node decides two things from the device its internet traffic leaves by:
// whether it holds a static address (a public address on that device), and
// whether it reaches the internet through a tunnel (a tunnel device carrying
// that traffic, or its public address bound off that device). Both ask the
// kernel, through every policy rule and routing table, so each node here runs
// on a real network stack built into a different shape before FluxOS starts
// (test-infra/network-shapes.sh).
//
// Every node keeps its fleet address on its fleet device, so a harness node
// cannot be a true NAT node - one whose public address is not on the machine at
// all. private-egress is the nearest shape: traffic leaves by a device holding
// no public address.
//
// The node image carries no ping, so distance is the TCP round trip to the
// node's own API port. A node's own address never leaves the container, so
// distance reads near on every node and the tunnel verdicts here come from the
// node's devices, never from distance.

const SHAPES = [
  {
    shape: null,
    label: 'a plain static node',
    staticIpState: 'STATIC',
    tunnel: 'none',
    reason: null,
    egress: 'eth0',
    tunnels: [],
  },
  {
    shape: 'private-egress',
    label: 'traffic leaving by a device with no public address',
    staticIpState: 'DYNAMIC',
    tunnel: 'likely',
    reason: 'localPublicIp',
    egress: 'dummy0',
    tunnels: [],
  },
  {
    shape: 'alias',
    label: 'its address bound under a label',
    staticIpState: 'STATIC',
    tunnel: 'none',
    reason: null,
    egress: 'eth0',
    tunnels: [],
  },
  {
    shape: 'idle-tunnel',
    label: 'a tunnel device its traffic does not use',
    staticIpState: 'STATIC',
    tunnel: 'none',
    reason: null,
    egress: 'eth0',
    tunnels: ['tailscale0'],
  },
  {
    shape: 'wg-full-tunnel',
    label: 'a wg-quick full tunnel routed by policy',
    staticIpState: 'DYNAMIC',
    tunnel: 'likely',
    reason: 'interface',
    egress: 'wg0',
    tunnels: ['wg0'],
  },
  {
    shape: 'def1-tunnel',
    label: 'an OpenVPN def1 split default',
    staticIpState: 'DYNAMIC',
    tunnel: 'likely',
    reason: 'interface',
    egress: 'wg1',
    tunnels: ['wg1'],
  },
  {
    shape: 'no-gateway-default',
    label: 'a default route with no gateway, as PPPoE installs',
    staticIpState: 'STATIC',
    tunnel: 'none',
    reason: null,
    egress: 'eth0',
    tunnels: [],
  },
];

describe('The device a node reaches the internet by', function () {
  let env;
  const uplinks = [];
  const geolocations = [];

  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(600000);
    const networkShapes = Object.fromEntries(SHAPES
      .map(({ shape }, index) => [index, shape])
      .filter(([, shape]) => shape));
    env = await createTestEnv({ hookCtx: this, nodes: SHAPES.length, networkShapes });
    await Promise.all(env.clients.map((client) => waitForDaemonReady(client)));

    await Promise.all(env.clients.map(async (client, index) => {
      let auth;
      await waitFor(
        async () => { auth = await authenticate(client.url, fluxTeamKey()); return true; },
        { timeout: 120000, interval: 2000, label: `node ${index} accepts a Flux team login` },
      );
      // Waits for the node's own reading, not for an answer: the uplink record
      // is empty until the first measurement, and the record the harness seeds
      // carries no static-IP state until the node decides one.
      await waitFor(
        async () => {
          const res = await client.getAuthed('/flux/uplink', auth.zelidauth);
          uplinks[index] = res.data;
          return Boolean(res.data?.measuredAt);
        },
        { timeout: 180000, interval: 3000, label: `node ${index} measured its uplink` },
      );
      await waitFor(
        async () => {
          geolocations[index] = await dbClient(index + 1).nodeGeolocation();
          return Boolean(geolocations[index]?.staticIpState);
        },
        { timeout: 180000, interval: 3000, label: `node ${index} decided its static IP` },
      );
    }));
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  SHAPES.forEach((expected, index) => {
    describe(`node ${index}: ${expected.label}`, function () {
      it('names the device its traffic leaves by', function () {
        expect(uplinks[index].egressDevice).to.equal(expected.egress);
      });

      it(`reads ${expected.staticIpState} for its static IP`, function () {
        expect(geolocations[index].staticIpState).to.equal(expected.staticIpState);
      });

      it(`reads tunnel ${expected.tunnel}${expected.reason ? ` (${expected.reason})` : ''}`, function () {
        expect({ tunnel: uplinks[index].tunnel, reason: uplinks[index].reason })
          .to.eql({ tunnel: expected.tunnel, reason: expected.reason });
      });

      it('lists the tunnel devices it was given', function () {
        const wireguard = uplinks[index].tunnelInterfaces
          .filter((device) => device.kind === 'wireguard')
          .map((device) => device.name);
        expect(wireguard).to.have.members(expected.tunnels);
      });

      it('times its own address over TCP and finds it near', function () {
        expect(uplinks[index].distance.method).to.equal('tcp');
        expect(uplinks[index].distance.rttMs).to.be.a('number').below(5);
      });
    });
  });
});
