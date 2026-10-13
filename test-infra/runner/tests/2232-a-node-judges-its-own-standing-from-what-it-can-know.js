// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv, SYNCTHING_FAULT } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { execInContainer } from '../framework/container.js';
import {
  setBenchmarkUnresolved, getJournal, clearJournal, setNodeList, setNodeStatus, clearNodeStatus,
} from '../framework/daemon-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const subnet = getSubnetConfig();

// A node judges its own standing on the network - whether its peers can reach
// it, whether it knows its own address, whether its collateral is listed where
// it should not be, whether its app ports can be reached - and holds itself out
// of service while one of those fails. Each check sets and clears only its own
// verdict, so one check passing never ends another's.

const REACHABILITY_MESSAGES = [
  'Flux communication is limited, other nodes on the network cannot reach yours through API calls',
  'Flux is not available for outside communication',
];
const IP_DETECTION_FAILED = 'Flux IP detection failed';
const PORTS_MESSAGE = /^Ports tested not reachable from outside/;

const dosOf = async (client) => (await client.getDOSState()).data ?? {};

describe('a node judges its own standing from what it can know', function () {
  describe('whether its peers can reach it, once what they test on it is known', function () {
    // Nodes 0 and 1 boot healthy. Node 2's syncthing cannot bind its port,
    // because something else holds it on loopback; node 3's syncthing is never
    // started. Both are deferred, so the fleet peers without them.
    const HEALTHY = [0, 1];
    const PORT_TAKEN = 2;
    const NOT_STARTED = 3;
    // Node 3 judges its syncthing down after this long without an answer.
    const HEALTH_WINDOW_MS = 30000;
    let env;
    dumpLogsOnFailure(() => env);
    const client = (i) => env.clients[i];

    before(async function () {
      this.timeout(600000);
      env = await createTestEnv({
        hookCtx: this,
        nodes: 4,
        deferredNodes: 2,
        syncthing: 'binary',
        syncthingFaults: { [PORT_TAKEN]: SYNCTHING_FAULT.PORT_TAKEN, [NOT_STARTED]: SYNCTHING_FAULT.NOT_STARTED },
        configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
        nodeConfigOverrides: {
          // Its sentinel passes often enough that syncthing, once started, is
          // set to listen on its port within seconds; and it never holds enough
          // distinct peers, so a check that finds it reachable finds it short.
          [NOT_STARTED]: {
            syncthing: { healthWindowMs: HEALTH_WINDOW_MS, sentinelIntervalMs: 5000 },
            fluxapps: { minUniqueIpsOutgoing: 50 },
          },
        },
      });
      await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    });

    after(async function () {
      this.timeout(60000);
      await env?.teardown();
    });

    it('asks first only once syncthing is known to be listening', async function () {
      this.timeout(180000);
      for (const i of HEALTHY) {
        // eslint-disable-next-line no-await-in-loop
        const known = await client(i).waitForEvent('syncthing:listenerKnown', () => true, 120000);
        // eslint-disable-next-line no-await-in-loop
        const first = await client(i).waitForEvent('availability:checked', () => true, 120000);

        expect(known.data.state, `node ${i}'s syncthing listener`).to.equal('listening');
        expect(first.id, `node ${i} asked after its syncthing listener was known`).to.be.greaterThan(known.id);
      }
    });

    it('asks a node whose syncthing cannot bind its port, finds it unreachable, and holds it out of service', async function () {
      this.timeout(240000);
      await env.startNode(PORT_TAKEN);
      const node = client(PORT_TAKEN);

      const known = await node.waitForEvent('syncthing:listenerKnown', () => true, 120000);
      const failed = await node.waitForEvent('availability:checked', (d) => d.available === false, 120000);

      expect(known.data.state).to.equal('cannotListen');
      expect(failed.id).to.be.greaterThan(known.id);
      expect(REACHABILITY_MESSAGES).to.include((await dosOf(node)).dosMessage);
    });

    it('asks again sooner after a failure than after a pass', async function () {
      this.timeout(240000);
      const node = client(PORT_TAKEN);
      const anchor = node.getLastEventId();
      await node.waitForEvent('availability:checked', (d) => d.available === false, 120000, { afterId: anchor });
      const failedAt = Date.now();
      await node.waitForEvent('availability:checked', () => true, 120000, { afterId: node.getLastEventId() });
      const recheckMs = Date.now() - failedAt;

      const healthy = client(HEALTHY[0]);
      const passAnchor = healthy.getLastEventId();
      await healthy.waitForEvent('availability:checked', (d) => d.available === true, 180000, { afterId: passAnchor });
      const passedAt = Date.now();
      await healthy.waitForEvent('availability:checked', () => true, 180000, { afterId: healthy.getLastEventId() });
      const intervalMs = Date.now() - passedAt;

      // availabilityRecheckMs and availabilityCheckIntervalMs in this fleet, each
      // plus the time one ask takes
      expect(recheckMs, 'after a failure').to.be.within(15000, 45000);
      expect(intervalMs, 'after a pass').to.be.within(55000, 90000);
    });

    it('asks again on the next node list refresh once a scheduled ask found it not confirmed', async function () {
      this.timeout(360000);
      const node = client(HEALTHY[1]);
      // Longer than the check interval plus one ask, so a scheduled ask lands
      // while the node is not confirmed.
      const UNCONFIRMED_MS = 100000;
      const passAnchor = node.getLastEventId();
      await node.waitForEvent('availability:checked', (d) => d.available === true, 180000, { afterId: passAnchor });

      await setNodeStatus(node.ip, 'EXPIRED');
      let quietAnchor;
      try {
        quietAnchor = node.getLastEventId();
        await new Promise((resolve) => { setTimeout(resolve, UNCONFIRMED_MS); });
      } finally {
        await clearNodeStatus(node.ip);
      }
      const askedUnconfirmed = node.getEventBuffer()
        .filter((e) => e.event === 'availability:checked' && e.id > quietAnchor);
      expect(askedUnconfirmed, 'asked while not confirmed').to.have.length(0);

      // The ticker refreshes the node list every block.
      const confirmedAnchor = node.getLastEventId();
      await node.waitForEvent('availability:checked', () => true, 120000, { afterId: confirmedAnchor });
    });

    it('asks a node whose syncthing never runs once syncthing is judged down, and holds it out of service', async function () {
      this.timeout(240000);
      const startedAt = Date.now();
      await env.startNode(NOT_STARTED);
      const node = client(NOT_STARTED);

      const known = await node.waitForEvent('syncthing:listenerKnown', () => true, 180000);
      const knownAfterMs = Date.now() - startedAt;
      const first = await node.waitForEvent('availability:checked', () => true, 120000);

      expect(known.data.state).to.equal('notRunning');
      expect(knownAfterMs, 'judged down no sooner than its health window').to.be.at.least(HEALTH_WINDOW_MS);
      expect(first.id, 'asked only once its syncthing was known').to.be.greaterThan(known.id);
      expect(first.data.available).to.equal(false);
      expect(REACHABILITY_MESSAGES).to.include((await dosOf(node)).dosMessage);
    });

    it('puts that node back in service once reachable, though it is short of peers', async function () {
      this.timeout(300000);
      const node = client(NOT_STARTED);
      await execInContainer(node.container, '/flux/test-infra/start-syncthing.sh');

      // Read from the node's DOS state, which says the same thing on every
      // version: a check that finds it reachable while it is short of peers
      // leaves it in service.
      await waitFor(async () => (await dosOf(node)).dosMessage === null, {
        timeout: 240000, interval: 2000, label: 'the node back in service',
      });

      expect((await dosOf(node)).dosState, 'its DOS state').to.be.below(10);
      const communication = await node.get(`/flux/checkcommunication?_=${Date.now()}`);
      expect(communication.status, 'the node is short of peers').to.equal('error');
    });
  });

  describe('whether it knows its own address, and whether its collateral is listed where it should not be', function () {
    const COLLIDES = 0;
    const UNRESOLVED = 2;
    const STUB_PEER = 3;
    let env;
    dumpLogsOnFailure(() => env);
    const client = (i) => env.clients[i];
    const ipOf = (i) => subnet.nodeIp(i + 1);
    const publicIpAsks = async () => (await getJournal({ method: 'getpublicip', sourceIp: ipOf(UNRESOLVED) })).total;

    before(async function () {
      this.timeout(600000);
      env = await createTestEnv({
        hookCtx: this,
        nodes: 4,
        stubPeers: [STUB_PEER],
        configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
      });
      await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    });

    after(async function () {
      this.timeout(60000);
      await setBenchmarkUnresolved(ipOf(UNRESOLVED), false).catch(() => {});
      await env?.teardown();
    });

    it('asks benchmark for its public IP while it knows no address, and is out of service after the eighth ask finds none and not before', async function () {
      this.timeout(300000);
      const node = client(UNRESOLVED);
      await clearJournal();
      await setBenchmarkUnresolved(ipOf(UNRESOLVED));

      await waitFor(async () => (await dosOf(node)).dosMessage === IP_DETECTION_FAILED, {
        timeout: 240000, interval: 1000, label: 'the node out of service for want of an address',
      });

      // Asks are publicIpAskIntervalMs apart and this looks every second, so the
      // count when it is first seen out of service is the ask that put it there.
      expect(await publicIpAsks(), 'asks when it went out of service').to.equal(8);
    });

    it('stops asking, and is back in service, once benchmark knows its address again', async function () {
      this.timeout(180000);
      const node = client(UNRESOLVED);
      await setBenchmarkUnresolved(ipOf(UNRESOLVED), false);

      await waitFor(async () => (await dosOf(node)).dosMessage === null, {
        timeout: 60000, interval: 1000, label: 'the node back in service',
      });
      const asks = await publicIpAsks();
      await new Promise((resolve) => { setTimeout(resolve, 60000); });

      expect(await publicIpAsks(), 'asks after its address came back').to.equal(asks);
    });

    it('holds itself out of service on the node list refresh that lists its collateral at a second address that answers', async function () {
      this.timeout(240000);
      const node = client(COLLIDES);
      const list = (await client(1).get(`/daemon/viewdeterministiczelnodelist?_=${Date.now()}`)).data;
      const own = list.find((entry) => String(entry.ip).split(':')[0] === ipOf(COLLIDES));
      const second = { ...own, ip: `${ipOf(STUB_PEER)}:16127` };

      const anchor = node.getLastEventId();
      await setNodeList([...list, second]);
      await node.waitForEvent('networkstate:updated', (d) => d.nodes === list.length + 1, 120000, { afterId: anchor });
      const refreshedAt = Date.now();
      await waitFor(async () => (await dosOf(node)).dosState >= 100, {
        timeout: 90000, interval: 500, label: 'the node out of service for the collision',
      });
      const afterRefreshMs = Date.now() - refreshedAt;
      await setNodeList(list);

      // the pass that refresh runs, which asks the second address whether it answers
      expect(afterRefreshMs, 'from the refresh to out of service').to.be.below(10000);
      expect((await dosOf(node)).dosMessage).to.include(`Node at ${ipOf(STUB_PEER)}:16127 is confirmed and reachable`);
    });

    it('is back in service once the node list lists its collateral at its own address only', async function () {
      this.timeout(240000);
      const node = client(COLLIDES);
      // The case before restored the list it found; each block refreshes it.
      await waitFor(async () => (await dosOf(node)).dosMessage === null, {
        timeout: 180000, interval: 1000, label: 'the node back in service',
      });
      expect((await dosOf(node)).dosState).to.equal(0);
    });
  });

  describe('whether its app ports can be reached', function () {
    // Node 2's app ports are refused from outside; node 1's too, while its peers
    // also cannot reach it. Both run the app port check at a pace a suite can
    // wait for, with the production rule: a failed port is retried on another,
    // and the node is out of service once its own count of failures reaches the
    // threshold.
    const PORTS_REFUSED = 2;
    const BOTH = 1;
    const APPS_PORT_CHECK = {
      timeoutsMs: {
        default: 20000, error: 5000, failure: 1000, dos: 15000, appError: 5000,
      },
      thresholds: { dos: 100, portsHighEdge: 3, portsLowEdge: 1 },
    };
    let env;
    dumpLogsOnFailure(() => env);
    const client = (i) => env.clients[i];
    // Refuses, from outside, every new connection to this node except to its
    // FluxOS and syncthing ports: a refusal, not a drop, so the peer testing a
    // port answers at once that it failed.
    const REFUSE = 'INPUT -p tcp -m multiport ! --dports 16126:16129 -m conntrack --ctstate NEW -j REJECT --reject-with tcp-reset';
    const refuseAppPorts = (i) => execInContainer(client(i).container, `iptables -I ${REFUSE}`);
    const admitAppPorts = (i) => execInContainer(client(i).container, `iptables -D ${REFUSE}`);

    before(async function () {
      this.timeout(600000);
      env = await createTestEnv({
        hookCtx: this,
        nodes: 3,
        configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
        nodeConfigOverrides: {
          [PORTS_REFUSED]: { fluxapps: { appsPortCheck: APPS_PORT_CHECK } },
          [BOTH]: { fluxapps: { appsPortCheck: APPS_PORT_CHECK } },
        },
      });
      await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    });

    after(async function () {
      this.timeout(60000);
      await env?.teardown();
    });

    it('holds a node whose app ports cannot be reached out of service with its ports message, and its passing reachability checks leave that standing', async function () {
      this.timeout(600000);
      const node = client(PORTS_REFUSED);
      await refuseAppPorts(PORTS_REFUSED);

      await waitFor(async () => PORTS_MESSAGE.test((await dosOf(node)).dosMessage ?? ''), {
        timeout: 480000, interval: 2000, label: 'the node out of service for its app ports',
      });
      const anchor = node.getLastEventId();
      await node.waitForEvent('availability:checked', (d) => d.available === true, 180000, { afterId: anchor });

      const dos = await dosOf(node);
      expect(dos.dosMessage).to.match(PORTS_MESSAGE);
      expect(dos.dosState).to.be.at.least(100);
    });

    it('puts that node back in service once its app ports can be reached again', async function () {
      this.timeout(240000);
      const node = client(PORTS_REFUSED);
      await admitAppPorts(PORTS_REFUSED);

      await waitFor(async () => (await dosOf(node)).dosMessage === null, {
        timeout: 180000, interval: 2000, label: 'the node back in service',
      });

      expect((await dosOf(node)).dosState).to.equal(0);
    });

    it('leaves another check\'s DOS standing when its own count reaches the threshold, and holds the node out of service once that ends', async function () {
      this.timeout(900000);
      const node = client(BOTH);
      // its peers answer that they cannot reach it
      await execInContainer(node.container, 'iptables -I INPUT -p tcp --dport 16129 -j REJECT --reject-with tcp-reset');
      await waitFor(async () => REACHABILITY_MESSAGES.includes((await dosOf(node)).dosMessage), {
        timeout: 180000, interval: 2000, label: 'the node out of service as unreachable',
      });
      await refuseAppPorts(BOTH);

      // long enough for its own count to reach the threshold several times over
      await new Promise((resolve) => { setTimeout(resolve, 300000); });
      expect(REACHABILITY_MESSAGES, 'its DOS while unreachable').to.include((await dosOf(node)).dosMessage);

      await execInContainer(node.container, 'iptables -D INPUT -p tcp --dport 16129 -j REJECT --reject-with tcp-reset');
      await waitFor(async () => PORTS_MESSAGE.test((await dosOf(node)).dosMessage ?? ''), {
        timeout: 240000, interval: 2000, label: 'the node out of service for its app ports',
      });
      await admitAppPorts(BOTH);
    });
  });

  describe('whether its peers can reach it while it has too few peer connections', function () {
    // The subject is the only real node and the stub peer the only node it can
    // ask, so every ask of a pass goes to that peer. It never holds enough
    // distinct peers, so a check that finds it reachable finds it short.
    const SUBJECT = 0;
    const OBSERVER = 1;
    let env;
    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(600000);
      env = await createTestEnv({
        hookCtx: this,
        nodes: 2,
        stubPeers: [OBSERVER],
        configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 0 } },
        nodeConfigOverrides: { [SUBJECT]: { fluxapps: { minUniqueIpsOutgoing: 50 } } },
      });
      await bootAndPeer(env, { minOutbound: 1, minInbound: 0 });
    });

    after(async function () {
      this.timeout(60000);
      await env?.teardown();
    });

    it('is not out of service for asks that failed before one reached it', async function () {
      this.timeout(240000);
      const node = env.clients[SUBJECT];
      const observer = env.stubPeerClients.get(OBSERVER);
      // Set between passes, so one pass meets every answer it is given.
      await node.waitForEvent('availability:checked', (d) => d.available === true, 120000, { afterId: node.getLastEventId() });
      const afterId = node.getLastEventId();
      const { availabilityAsks: asksBefore } = await observer.answerAvailabilityUnreachable(5);

      const checked = await node.waitForEvent('availability:checked', () => true, 120000, { afterId });

      const { availabilityAsks } = await observer.getStats();
      expect(availabilityAsks - asksBefore, 'fixture: five asks answered "not available", then one truthfully').to.equal(6);
      expect(checked.data.available, 'the pass whose last ask reached it').to.equal(true);
      expect((await dosOf(node)).dosMessage).to.equal(null);
      expect((await dosOf(node)).dosState).to.be.below(10);
    });
  });

  describe('whether it has the peer connections it needs', function () {
    // Stub peers never dial in, so the subject has no incoming connection until
    // the two deferred nodes start, and each of them dials every listed node.
    // Its count for too few peers runs fast, so it is out of service for them
    // within a few minutes rather than production's 77.
    const SUBJECT = 0;
    const DIALERS = [4, 5];
    let env;
    dumpLogsOnFailure(() => env);
    const SHORTFALL = /^Not enough incoming connections/;

    before(async function () {
      this.timeout(600000);
      env = await createTestEnv({
        hookCtx: this,
        nodes: 6,
        deferredNodes: 2,
        stubPeers: [1, 2, 3],
        configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
        nodeConfigOverrides: {
          [SUBJECT]: { fluxapps: { minIncoming: 2, minUniqueIpsOutgoing: 1, minUniqueIpsIncoming: 2, peerShortfallDosPerMinute: 6 } },
          ...Object.fromEntries(DIALERS.map((i) => [i, { fluxapps: { minOutgoing: 5 } }])),
        },
      });
      await bootAndPeer(env, { minOutbound: 1, minInbound: 0 });
    });

    after(async function () {
      this.timeout(60000);
      await env?.teardown();
    });

    it('holds itself out of service while it has too few incoming connections', async function () {
      this.timeout(420000);
      const node = env.clients[SUBJECT];

      await waitFor(async () => SHORTFALL.test((await dosOf(node)).dosMessage ?? ''), {
        timeout: 360000, interval: 3000, label: 'the subject out of service for too few incoming connections',
      });

      expect((await dosOf(node)).dosState).to.be.above(10);
    });

    it('is back in service as soon as the nodes that make enough connect to it', async function () {
      this.timeout(300000);
      const node = env.clients[SUBJECT];
      expect(SHORTFALL.test((await dosOf(node)).dosMessage ?? ''), 'fixture: out of service for too few incoming connections').to.equal(true);

      await Promise.all(DIALERS.map((i) => env.startNode(i)));

      await waitFor(async () => (await dosOf(node)).dosMessage === null, {
        timeout: 240000, interval: 2000, label: 'the subject back in service',
      });
      expect((await dosOf(node)).dosState).to.equal(0);
    });
  });
});
