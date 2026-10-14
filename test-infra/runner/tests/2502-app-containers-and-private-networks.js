// App containers and the networks around a node: the DOCKER-USER chain that keeps
// an app off the node owner's private networks and link-local addresses, lets one
// app network reach another only through a published port at the node's address,
// and gives no exception to a network FluxOS did not create - and the ordinary
// traffic it must leave alone.
//
// The containers run on the node's own docker. Most sit on networks created as
// FluxOS creates an app's (fluxDockerNetwork_<app>, a 172.23.x.0/24 bridge), from a
// static busybox image so an app can make the connections under test; FluxOS is
// restarted once they exist, so its boot applies the chain with their bridges. One
// app is installed through FluxOS, so its network is created by FluxOS itself. The
// node runs with its firewall on, as nodes do. The node also holds the owner's
// networks: a LAN behind a host bridge named like a docker one (br-e2elan, in
// 172.23.200.0/24), and a LAN behind a plain interface (lan0: 172.23.201.0/24 and
// 192.168.88.0/24), each with a host answering on it. A second node, without a
// firewall, is the world outside.
//
// Every "blocked" is read two ways: no answer came back, and a mangle POSTROUTING
// counter for the destination saw no packet leave the node towards it. Every
// listener a blocked case aims at answers the node itself (the canaries), so a
// silence is never a listener that was not there. The last part strips Docker's
// own isolation rules, so the chain alone must hold.
//
// The harness host runs without br_netfilter; 2503 runs these paths with it loaded.
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, restartDockerd, restartFluxos } from '../framework/container.js';
import { pushBusybox } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { REGISTRY_REPO_HOST, REGISTRY_PORT, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor, waitForAppInstalled, waitForAppRemoved, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure, startCapture, stopCapture } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';

const NODE = 0;
const OUTSIDE = 1;
const IMAGE_REPO = 'e2enettools';
const APP_IMAGE_REPO = 'e2enetapp';
const APP_NETWORK = { name: 'fluxDockerNetwork_e2eprobe', subnet: '172.23.250' };
const OTHER_NETWORK = { name: 'fluxDockerNetwork_e2eother', subnet: '172.23.251' };
const SYSTEM_NETWORK = { name: 'fluxDockerNetwork', subnet: '172.23.0' };
// Networks FluxOS does not create: one in private space, one in public space.
const OWNER_NETWORK = { name: 'e2eownernet', subnet: '172.30.250' };
const OWNER_PUBLIC_NETWORK = { name: 'e2eownerpub', subnet: '31.201.250' };
// Inside 10.0.0.0/8; nothing on the fleet network holds it.
const PRIVATE_TARGET = '10.255.255.1';
// The owner's LAN behind a host bridge named as docker names its bridges.
const HOST_BRIDGE = 'br-e2elan';
const BRIDGE_LAN = { gateway: '172.23.200.1', host: '172.23.200.10' };
// The owner's LAN behind a plain interface.
const UPLINK_LAN = { gateway: '172.23.201.1', host: '172.23.201.10', privateGateway: '192.168.88.1', privateHost: '192.168.88.10' };
const FLUX_NODE_SERVICE = '169.254.43.43:16101';
const LINK_LOCAL_TARGET = '169.254.169.254';
// One address inside each blocked range, none held by anything on the node.
const BLOCKED_TARGETS = {
  '10.0.0.0/8': PRIVATE_TARGET,
  '172.16.0.0/12': '172.31.255.1',
  '192.168.0.0/16': '192.168.255.1',
  '100.64.0.0/10': '100.127.255.1',
  '169.254.0.0/16': LINK_LOCAL_TARGET,
  '198.18.0.0/15': '198.19.255.1',
  '192.0.2.0/24': '192.0.2.1',
  '198.51.100.0/24': '198.51.100.1',
  '203.0.113.0/24': '203.0.113.1',
};
// Published ports, as FluxOS publishes an app's and opens it in ufw.
const PUBLISHED_PORT = 31999;
const OTHER_PUBLISHED_PORT = 31998;
const OTHER_UDP_PUBLISHED_PORT = 31996;
const DEFAULT_PUBLISHED_PORT = 31995;
const OWNER_PUBLISHED_PORT = 31994;
// The owner's port forward from the node to a LAN host.
const OWNER_FORWARD_PORT = 2222;
// Every app container listens on TCP 8080, 8100 and 53 and answers UDP on 9001.
const TCP_PORT = 8080;
const UNPUBLISHED_PORT = 8100;
const UDP_PORT = 9001;
const FLEET_UDP_PORT = 9999;
// The address a home router gives the outside client when it rewrites the source
// of a connection into the node.
const ROUTER_SOURCE = '192.168.77.2';
const API_PORT = 16127;
const RULES_TIMEOUT_MS = 180000;
const BUSYBOX = '/usr/local/bin/busybox';

const subnet = getSubnetConfig();

describe('2502 app containers are kept off private networks and off each other\'s networks', function suite() {
  this.timeout(1200000);

  let env;
  let node;
  let outside;
  let image;
  let restartedAt;
  let dockerMajor;
  dumpLogsOnFailure(() => env);

  const inNode = async (command) => execInContainer(node.container, command);
  const inOutside = async (command) => execInContainer(outside.container, command);
  const inApp = async (name, command) => inNode(`docker exec ${name} /bin/busybox ${command}`);

  // Packets a DOCKER-USER rule has matched, found by the words of its listing.
  async function ruleHits(...words) {
    const { stdout } = await inNode('iptables -L DOCKER-USER -v -x -n');
    const line = stdout.split('\n').find((l) => words.every((w) => l.includes(w)));
    if (!line) throw new Error(`no DOCKER-USER rule with ${words.join(' ')}:\n${stdout}`);
    return Number(line.trim().split(/\s+/)[0]);
  }

  // Packets a DOCKER-USER rule matching only the way out has matched: `-o <bridge> -j <target>`,
  // or `-o <bridge> -m conntrack --ctstate DNAT -j RETURN` when dnat is set.
  async function outHits(target, bridge, { dnat = false } = {}) {
    const { stdout } = await inNode('iptables -L DOCKER-USER -v -x -n');
    const row = stdout.split('\n').map((l) => l.trim().split(/\s+/)).find((c) => c[2] === target && c[5] === '*' && c[6] === bridge
      && (dnat ? c.includes('DNAT') : c.length === 9));
    if (!row) throw new Error(`no DOCKER-USER ${target} out to ${bridge}${dnat ? ' (DNAT)' : ''}:\n${stdout}`);
    return Number(row[0]);
  }

  async function chain() {
    const { stdout } = await inNode('iptables -S DOCKER-USER');
    return stdout.trim();
  }

  async function containerIp(name) {
    const { stdout } = await inNode(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${name}`);
    return stdout.trim();
  }

  // A docker network's bridge, as Docker names it: its bridge.name option, else br- and
  // the first 12 characters of its id.
  async function bridgeOf(network) {
    const { stdout } = await inNode(`docker network inspect -f '{{json .Options}} {{.Id}}' ${network}`);
    const [options, id] = stdout.trim().split(' ');
    return JSON.parse(options)['com.docker.network.bridge.name'] || `br-${id.slice(0, 12)}`;
  }

  async function tcpAnswer(name, host, port) {
    const { stdout } = await inApp(name, `sh -c 'echo | /bin/busybox nc -w 3 ${host} ${port}'`);
    return stdout.trim();
  }

  async function udpAnswer(name, host, port) {
    const { stdout } = await inApp(name, `sh -c 'echo x | /bin/busybox nc -u -w 2 ${host} ${port}'`);
    return stdout.trim();
  }

  async function pings(name, host) {
    return (await inApp(name, `ping -c 1 -W 2 ${host}`)).exitCode === 0;
  }

  async function tcpConnects(name, host, port) {
    const { exitCode } = await inApp(name, `sh -c 'echo | /bin/busybox nc -w 3 ${host} ${port}'`);
    return exitCode === 0;
  }

  // Packets that left the node towards a destination while `action` ran: counted in
  // mangle POSTROUTING, which sees a forwarded packet only once the filter table let it go.
  async function delivered(destination, port, proto, action) {
    const match = proto === 'icmp' ? `-d ${destination} -p icmp` : `-d ${destination} -p ${proto} --dport ${port}`;
    await inNode(`iptables -t mangle -I POSTROUTING ${match} -m comment --comment e2e-delivered -j RETURN`);
    try {
      const result = await action();
      const { stdout } = await inNode('iptables -t mangle -L POSTROUTING -v -x -n');
      const line = stdout.split('\n').find((l) => l.includes('e2e-delivered'));
      return { result, packets: Number(line.trim().split(/\s+/)[0]) };
    } finally {
      await inNode(`iptables -t mangle -D POSTROUTING ${match} -m comment --comment e2e-delivered -j RETURN`);
    }
  }

  // A TCP connection that must not get through: no answer, and nothing left the node towards it.
  async function expectTcpBlocked(name, host, port, { to = host, toPort = port } = {}) {
    const { result, packets } = await delivered(to, toPort, 'tcp', () => tcpAnswer(name, host, port));
    expect(result, `${name} was answered by ${host}:${port}`).to.equal('');
    expect(packets, `packets that left the node for ${to}:${toPort}`).to.equal(0);
  }

  async function expectUdpBlocked(name, host, port) {
    const { result, packets } = await delivered(host, port, 'udp', () => udpAnswer(name, host, port));
    expect(result, `${name} was answered by ${host}:${port}/udp`).to.equal('');
    expect(packets, `packets that left the node for ${host}:${port}/udp`).to.equal(0);
  }

  async function expectPingBlocked(name, host) {
    const { result, packets } = await delivered(host, null, 'icmp', () => pings(name, host));
    expect(result, `${name} pinged ${host}`).to.equal(false);
    expect(packets, `ICMP that left the node for ${host}`).to.equal(0);
  }

  // What nc said, for an assertion message: its exit code and its error output.
  const ncSaid = ({ exitCode, stderr }) => `nc exit ${exitCode}: ${(stderr || '').trim()}`;

  // A UDP responder: answers each datagram with "ok", one nc after another.
  const udpResponder = (bb, port) => `${bb} sh -c "while true; do echo ok | ${bb} nc -u -l -p ${port} -w 1; done"`;

  // An app container serving TCP 8080, 8100 and 53 and UDP 9001.
  const serving = (name, network, extra = '') => `docker run -d --name ${name} --network ${network} ${extra} --entrypoint /bin/busybox ${image} sh -c '`
    + `/bin/busybox nc -lk -p ${TCP_PORT} -e /bin/busybox echo ok & /bin/busybox nc -lk -p ${UNPUBLISHED_PORT} -e /bin/busybox echo ok & `
    + `/bin/busybox nc -lk -p 53 -e /bin/busybox echo ok & ${udpResponder('/bin/busybox', UDP_PORT)} & exec /bin/busybox sleep 2147483647' >/dev/null`;

  // A host on one of the owner's LANs, in a namespace of its own, serving TCP 8080 and 53
  // and UDP 9001 and 53.
  const lanHost = (ns) => [
    `ip netns exec ${ns} setsid ${BUSYBOX} nc -lk -p ${TCP_PORT} -e ${BUSYBOX} echo ok >/dev/null 2>&1 &`,
    `ip netns exec ${ns} setsid ${BUSYBOX} nc -lk -p 53 -e ${BUSYBOX} echo ok >/dev/null 2>&1 &`,
    `ip netns exec ${ns} setsid ${udpResponder(BUSYBOX, UDP_PORT)} >/dev/null 2>&1 &`,
    `ip netns exec ${ns} setsid ${udpResponder(BUSYBOX, 53)} >/dev/null 2>&1 &`,
  ];

  before(async function hook() {
    env = await createTestEnv({
      hookCtx: this, nodes: 3, firewall: [NODE], tickerAutostart: false,
    });
    node = env.clients[NODE];
    outside = env.clients[OUTSIDE];
    await bootAndPeer(env);
    await pushBusybox(IMAGE_REPO, 'v1');
    image = `${REGISTRY_REPO_HOST}/${IMAGE_REPO}:v1`;

    const network = (n) => `docker network create --subnet ${n.subnet}.0/24 --gateway ${n.subnet}.1 ${n.name} >/dev/null`;
    const setup = await inNode([
      'set -e',
      `cid=$(docker create ${image}); docker cp "$cid:/bin/busybox" ${BUSYBOX}; docker rm "$cid" >/dev/null`,
      ...[APP_NETWORK, OTHER_NETWORK, OWNER_NETWORK, OWNER_PUBLIC_NETWORK].map(network),
      `docker network inspect ${SYSTEM_NETWORK.name} >/dev/null 2>&1 || ${network(SYSTEM_NETWORK)}`,
      `docker run -d --name fluxe2eprobe --network ${APP_NETWORK.name} --cap-add NET_ADMIN ${image} >/dev/null`,
      serving('fluxe2epeer', APP_NETWORK.name),
      serving('fluxe2epublished', APP_NETWORK.name, `-p ${PUBLISHED_PORT}:${TCP_PORT}`),
      serving('fluxe2eother', OTHER_NETWORK.name),
      serving('fluxe2eotherpublished', OTHER_NETWORK.name, `-p ${OTHER_PUBLISHED_PORT}:${TCP_PORT} -p ${OTHER_UDP_PUBLISHED_PORT}:${UDP_PORT}/udp`),
      serving('fluxe2esystem', SYSTEM_NETWORK.name),
      `docker run -d --name fluxe2edefault --cap-add NET_ADMIN ${image} >/dev/null`,
      serving('fluxe2edefaultpeer', 'bridge', `-p ${DEFAULT_PUBLISHED_PORT}:${TCP_PORT}`),
      serving('fluxe2eowner', OWNER_NETWORK.name, `-p ${OWNER_PUBLISHED_PORT}:${TCP_PORT}`),
      serving('fluxe2eownerpub', OWNER_PUBLIC_NETWORK.name),
      ...[PUBLISHED_PORT, OTHER_PUBLISHED_PORT, DEFAULT_PUBLISHED_PORT, OWNER_PUBLISHED_PORT].map((port) => `ufw allow ${port}/tcp >/dev/null`),
      `ufw allow ${OTHER_UDP_PUBLISHED_PORT}/udp >/dev/null`,
      // The owner's LAN behind a host bridge named like a docker one.
      'ip netns add lanb',
      `ip link add ${HOST_BRIDGE} type bridge && ip addr add ${BRIDGE_LAN.gateway}/24 dev ${HOST_BRIDGE} && ip link set ${HOST_BRIDGE} up`,
      `ip link add vlanb0 type veth peer name vlanb1 && ip link set vlanb0 master ${HOST_BRIDGE} up && ip link set vlanb1 netns lanb`,
      `ip -n lanb addr add ${BRIDGE_LAN.host}/24 dev vlanb1 && ip -n lanb link set vlanb1 up && ip -n lanb link set lo up`,
      `ip -n lanb route add default via ${BRIDGE_LAN.gateway}`,
      ...lanHost('lanb'),
      // The owner's LAN behind a plain interface.
      'ip netns add lanu',
      'ip link add lan0 type veth peer name vlanu1 && ip link set vlanu1 netns lanu',
      `ip addr add ${UPLINK_LAN.gateway}/24 dev lan0 && ip addr add ${UPLINK_LAN.privateGateway}/24 dev lan0 && ip link set lan0 up`,
      `ip -n lanu addr add ${UPLINK_LAN.host}/24 dev vlanu1 && ip -n lanu addr add ${UPLINK_LAN.privateHost}/24 dev vlanu1`,
      'ip -n lanu link set vlanu1 up && ip -n lanu link set lo up',
      `ip -n lanu route add default via ${UPLINK_LAN.gateway}`,
      ...lanHost('lanu'),
      // The owner's port forward from the node to a LAN host.
      `iptables -t nat -A PREROUTING -p tcp --dport ${OWNER_FORWARD_PORT} -j DNAT --to-destination ${UPLINK_LAN.privateHost}:${TCP_PORT}`,
    ].join('\n'));
    expect(setup.exitCode, `setup failed: ${setup.stderr}`).to.equal(0);

    dockerMajor = Number((await inNode('docker version -f {{.Server.Version}}')).stdout.trim().split('.')[0]);

    // FluxOS's boot applies the chain with the networks that exist now.
    restartedAt = node.getLastEventId();
    await restartFluxos(node.container);
    await waitForBootSettled(node, RULES_TIMEOUT_MS, { afterId: restartedAt });
  });

  after(async () => {
    await env?.teardown();
  });

  // Every test's packets on both nodes, decoded into the failure dump.
  beforeEach(async () => {
    await Promise.all([node, outside].map((n) => startCapture(n.container)));
  });

  afterEach(async () => {
    await Promise.all([node, outside].map((n) => stopCapture(n.container)));
  });

  describe('the listeners a blocked case aims at answer the node itself', () => {
    it('every app container and every LAN host answers', async () => {
      const targets = [
        ...await Promise.all(['fluxe2epeer', 'fluxe2eother', 'fluxe2eotherpublished', 'fluxe2esystem', 'fluxe2edefaultpeer', 'fluxe2eowner', 'fluxe2eownerpub'].map(containerIp)),
        BRIDGE_LAN.host, UPLINK_LAN.host, UPLINK_LAN.privateHost,
      ];
      // eslint-disable-next-line no-restricted-syntax
      for (const target of targets) {
        // eslint-disable-next-line no-await-in-loop
        const tcp = await inNode(`echo | ${BUSYBOX} nc -w 3 ${target} ${TCP_PORT}`);
        expect(tcp.stdout.trim(), `${target}:${TCP_PORT} from the node`).to.equal('ok');
      }
      const udp = await inNode(`echo x | ${BUSYBOX} nc -u -w 2 ${await containerIp('fluxe2eother')} ${UDP_PORT}`);
      expect(udp.stdout.trim(), 'UDP from the node').to.equal('ok');
      const lanUdp = await inNode(`echo x | ${BUSYBOX} nc -u -w 2 ${BRIDGE_LAN.host} ${UDP_PORT}`);
      expect(lanUdp.stdout.trim(), 'UDP to the LAN from the node').to.equal('ok');
    });
  });

  describe('the chain', () => {
    // Every app container start at boot waits for boot:settled.
    it('applies the rules before the node lets any app container start', async () => {
      const since = node.getEventBuffer().filter((e) => e.id > restartedAt);
      const settled = since.find((e) => e.event === 'boot:settled');
      const applied = since.find((e) => e.event === 'firewall:containerEgressApplied');
      expect(applied, 'the rules were never applied').to.not.equal(undefined);
      expect(applied.id).to.be.below(settled.id);
    });

    it('names docker0 and each FluxOS network\'s bridge, and drops into every docker network', async () => {
      const rules = (await chain()).split('\n');
      const flux = await Promise.all([SYSTEM_NETWORK, APP_NETWORK, OTHER_NETWORK].map((n) => bridgeOf(n.name)));
      const owner = await Promise.all([OWNER_NETWORK, OWNER_PUBLIC_NETWORK].map((n) => bridgeOf(n.name)));
      ['docker0', ...flux].forEach((bridge) => {
        expect(rules, `same-network exception for ${bridge}`).to.include(`-A DOCKER-USER -i ${bridge} -o ${bridge} -j RETURN`);
        expect(rules, `published-port exception for ${bridge}`).to.include(`-A DOCKER-USER -o ${bridge} -m conntrack --ctstate DNAT -j RETURN`);
      });
      ['docker0', ...flux, ...owner].forEach((bridge) => expect(rules, `drop into ${bridge}`).to.include(`-A DOCKER-USER -o ${bridge} -j DROP`));
      owner.forEach((bridge) => expect(rules.filter((r) => r.includes(bridge) && r.endsWith('RETURN')), `no exception for ${bridge}`).to.deep.equal([]));
      expect(rules.filter((r) => r.includes(HOST_BRIDGE)), 'nothing names the host bridge').to.deep.equal([]);
      expect(rules.filter((r) => /-d 172\.23\./.test(r)), 'no exception by address').to.deep.equal([]);
      expect(rules.filter((r) => /physdev/.test(r))).to.deep.equal([]);
    });

    it('matches traffic out of a container by the bridge it comes from, not its source address', async () => {
      const rules = await chain();
      expect(rules).to.include('-A DOCKER-USER -d 10.0.0.0/8 -i br-+ -j DROP');
      expect(rules).to.include('-A DOCKER-USER -d 169.254.0.0/16 -i br-+ -j DROP');
      expect(rules).to.include('-A DOCKER-USER -d 10.0.0.0/8 -i docker0 -j DROP');
      expect(rules.split('\n').filter((rule) => / -s /.test(rule))).to.deep.equal([]);
    });
  });

  describe('traffic that must pass', () => {
    it('connects an app\'s own containers to each other, over TCP, UDP and ICMP', async () => {
      const peer = await containerIp('fluxe2epeer');
      expect(await tcpAnswer('fluxe2eprobe', peer, TCP_PORT)).to.equal('ok');
      expect(await udpAnswer('fluxe2eprobe', peer, UDP_PORT)).to.equal('ok');
      expect(await pings('fluxe2eprobe', peer)).to.equal(true);
    });

    it('connects two containers on docker0', async () => {
      expect(await tcpAnswer('fluxe2edefault', await containerIp('fluxe2edefaultpeer'), TCP_PORT)).to.equal('ok');
    });

    it('reaches the fleet over TCP, UDP and ICMP', async () => {
      expect(await tcpConnects('fluxe2eprobe', subnet.registry, REGISTRY_PORT), 'TCP to the fleet registry').to.equal(true);

      await inOutside(`rm -f /tmp/udp-in; nc -u -l ${FLEET_UDP_PORT} > /tmp/udp-in </dev/null 2>/dev/null & echo $! > /tmp/udp-pid`);
      await inApp('fluxe2eprobe', `sh -c 'sleep 1; echo from-an-app | /bin/busybox nc -u -w 1 ${outside.ip} ${FLEET_UDP_PORT}'`);
      const { stdout: received } = await inOutside('sleep 1; cat /tmp/udp-in; kill "$(cat /tmp/udp-pid)" 2>/dev/null || true');
      expect(received, 'UDP to a fleet node').to.include('from-an-app');

      const ping = await inApp('fluxe2eprobe', `ping -c 1 -W 3 ${outside.ip}`);
      expect(ping.exitCode, `ICMP to a fleet node: ${ping.stdout}`).to.equal(0);
    });

    // The outside node's nc (netcat-openbsd) sends nothing: given input and then
    // the end of it, it sometimes exits without printing an answer it received.
    it('answers a client outside the node on the app\'s published port', async () => {
      const answer = await inOutside(`nc -w 5 ${node.ip} ${PUBLISHED_PORT} </dev/null`);
      expect(answer.stdout.trim(), ncSaid(answer)).to.equal('ok');
    });

    it('answers a client whose router rewrote its source to a private address', async () => {
      await inOutside(`ip addr add ${ROUTER_SOURCE}/32 dev eth0`);
      await inNode(`ip route add ${ROUTER_SOURCE}/32 via ${outside.ip}`);
      try {
        const answer = await inOutside(`nc -s ${ROUTER_SOURCE} -w 5 ${node.ip} ${PUBLISHED_PORT} </dev/null`);
        expect(answer.stdout.trim(), `the reply to a private address; ${ncSaid(answer)}`).to.equal('ok');
      } finally {
        await inNode(`ip route del ${ROUTER_SOURCE}/32 via ${outside.ip}`);
        await inOutside(`ip addr del ${ROUTER_SOURCE}/32 dev eth0`);
      }
    });

    it('answers clients on the owner\'s LANs on the app\'s published port', async () => {
      // eslint-disable-next-line no-restricted-syntax
      for (const ns of ['lanb', 'lanu']) {
        // eslint-disable-next-line no-await-in-loop
        const answer = await inNode(`echo | ip netns exec ${ns} ${BUSYBOX} nc -w 3 ${node.ip} ${PUBLISHED_PORT}`);
        expect(answer.stdout.trim(), `a client in ${ns}`).to.equal('ok');
      }
    });

    it('reaches its own node\'s API and its own published port at the node\'s address', async () => {
      expect(await tcpConnects('fluxe2eprobe', node.ip, API_PORT), 'the node\'s API').to.equal(true);
      expect(await tcpAnswer('fluxe2eprobe', node.ip, PUBLISHED_PORT), 'its own published port').to.equal('ok');
    });

    it('reaches another app\'s published TCP port at the node\'s address and at either network\'s gateway', async () => {
      expect(await tcpAnswer('fluxe2eprobe', node.ip, OTHER_PUBLISHED_PORT), 'at the node\'s address').to.equal('ok');
      expect(await tcpAnswer('fluxe2eprobe', `${OTHER_NETWORK.subnet}.1`, OTHER_PUBLISHED_PORT), 'its network\'s gateway').to.equal('ok');
      expect(await tcpAnswer('fluxe2eprobe', `${APP_NETWORK.subnet}.1`, OTHER_PUBLISHED_PORT), 'its own gateway').to.equal('ok');
    });

    // Before Docker 28, Docker does not return the reply to a UDP request one container
    // sends another's published port at the node's address, whatever DOCKER-USER holds;
    // there the request reaching the container is what the chain decides.
    it('reaches another app\'s published UDP port at the node\'s address', async () => {
      const { result, packets } = await delivered(await containerIp('fluxe2eotherpublished'), UDP_PORT, 'udp', () => udpAnswer('fluxe2eprobe', node.ip, OTHER_UDP_PUBLISHED_PORT));
      if (dockerMajor >= 28) expect(result).to.equal('ok');
      else expect(packets, 'the request reaching the container').to.be.above(0);
    });

    it('reaches docker0\'s published port from an app, and an app\'s from docker0', async () => {
      expect(await tcpAnswer('fluxe2eprobe', node.ip, DEFAULT_PUBLISHED_PORT)).to.equal('ok');
      expect(await tcpAnswer('fluxe2edefault', node.ip, OTHER_PUBLISHED_PORT)).to.equal('ok');
    });

    it('lets an app\'s DNS reach a private address over UDP and TCP, a LAN resolver included', async () => {
      const udpBefore = await ruleHits('RETURN', 'br-+', 'udp dpt:53');
      await inApp('fluxe2eprobe', `sh -c 'echo | /bin/busybox nc -u -w 1 ${PRIVATE_TARGET} 53'`);
      expect(await ruleHits('RETURN', 'br-+', 'udp dpt:53')).to.be.above(udpBefore);
      expect(await udpAnswer('fluxe2eprobe', UPLINK_LAN.privateHost, 53), 'UDP to a LAN resolver').to.equal('ok');
      expect(await tcpAnswer('fluxe2eprobe', UPLINK_LAN.privateHost, 53), 'TCP to a LAN resolver').to.equal('ok');
      expect(await tcpAnswer('fluxe2eprobe', BRIDGE_LAN.host, 53), 'TCP to a resolver behind the host bridge').to.equal('ok');
    });

    it('still lets an app reach fluxnode.service and the node\'s own addresses', async () => {
      const [host, port] = FLUX_NODE_SERVICE.split(':');
      expect(await tcpConnects('fluxe2eprobe', host, port), 'fluxnode.service').to.equal(true);
      expect(await tcpConnects('fluxe2eprobe', `${APP_NETWORK.subnet}.1`, API_PORT), 'the API at its gateway').to.equal(true);
      expect(await tcpConnects('fluxe2eprobe', UPLINK_LAN.privateGateway, API_PORT), 'the API at the node\'s LAN address').to.equal(true);
    });
  });

  describe('traffic that must not pass', () => {
    it('keeps an app off another app\'s container, on every port and protocol', async () => {
      const other = await containerIp('fluxe2eotherpublished');
      await expectTcpBlocked('fluxe2eprobe', other, TCP_PORT);
      await expectTcpBlocked('fluxe2eprobe', other, UNPUBLISHED_PORT);
      await expectTcpBlocked('fluxe2eprobe', other, 53);
      await expectUdpBlocked('fluxe2eprobe', other, UDP_PORT);
      await expectPingBlocked('fluxe2eprobe', other);
    });

    it('keeps an app off the FluxOS system network\'s containers and docker0\'s', async () => {
      await expectTcpBlocked('fluxe2eprobe', await containerIp('fluxe2esystem'), TCP_PORT);
      await expectTcpBlocked('fluxe2eprobe', await containerIp('fluxe2edefaultpeer'), TCP_PORT);
      await expectTcpBlocked('fluxe2edefault', await containerIp('fluxe2epeer'), TCP_PORT);
    });

    it('keeps an app off networks FluxOS did not create, private or public, and them off it', async () => {
      await expectTcpBlocked('fluxe2eprobe', await containerIp('fluxe2eowner'), TCP_PORT);
      await expectTcpBlocked('fluxe2eprobe', await containerIp('fluxe2eownerpub'), TCP_PORT);
      await expectTcpBlocked('fluxe2eowner', await containerIp('fluxe2epeer'), TCP_PORT);
      await expectTcpBlocked('fluxe2eowner', UPLINK_LAN.privateHost, TCP_PORT);
    });

    it('drops a connection from outside into a network FluxOS did not create, its published port included', async () => {
      const ownerBridge = await bridgeOf(OWNER_NETWORK.name);
      const before = await outHits('DROP', ownerBridge);
      const answer = await inOutside(`nc -w 3 ${node.ip} ${OWNER_PUBLISHED_PORT} </dev/null`);
      expect(answer.stdout.trim(), ncSaid(answer)).to.equal('');
      expect(await outHits('DROP', ownerBridge)).to.be.above(before);
    });

    it('keeps an app off the owner\'s LAN behind a host bridge named like a docker one: 172.23 over TCP, UDP and ICMP', async () => {
      const before = await ruleHits('DROP', 'br-+', '172.16.0.0/12');
      await expectTcpBlocked('fluxe2eprobe', BRIDGE_LAN.host, TCP_PORT);
      await expectUdpBlocked('fluxe2eprobe', BRIDGE_LAN.host, UDP_PORT);
      await expectPingBlocked('fluxe2eprobe', BRIDGE_LAN.host);
      expect(await ruleHits('DROP', 'br-+', '172.16.0.0/12')).to.be.above(before);
    });

    it('keeps an app off the owner\'s LAN behind a plain interface: 172.23 and 192.168', async () => {
      await expectTcpBlocked('fluxe2eprobe', UPLINK_LAN.host, TCP_PORT);
      await expectUdpBlocked('fluxe2eprobe', UPLINK_LAN.host, UDP_PORT);
      await expectTcpBlocked('fluxe2eprobe', UPLINK_LAN.privateHost, TCP_PORT);
      await expectUdpBlocked('fluxe2eprobe', UPLINK_LAN.privateHost, UDP_PORT);
      await expectPingBlocked('fluxe2eprobe', UPLINK_LAN.privateHost);
    });

    it('keeps an app off a LAN host the owner forwards a node port to', async () => {
      await expectTcpBlocked('fluxe2eprobe', node.ip, OWNER_FORWARD_PORT, { to: UPLINK_LAN.privateHost, toPort: TCP_PORT });
    });

    Object.entries(BLOCKED_TARGETS).forEach(([range, target]) => {
      it(`drops an app's connection into ${range}`, async () => {
        const before = await ruleHits('DROP', 'br-+', range);
        expect(await tcpConnects('fluxe2eprobe', target, 80)).to.equal(false);
        expect(await ruleHits('DROP', 'br-+', range)).to.be.above(before);
      });
    });

    it('drops a private destination on a resolver\'s other ports', async () => {
      const before = await ruleHits('DROP', 'br-+', '10.0.0.0/8');
      expect(await tcpConnects('fluxe2eprobe', PRIVATE_TARGET, 853)).to.equal(false);
      expect(await ruleHits('DROP', 'br-+', '10.0.0.0/8')).to.be.above(before);
    });

    it('drops a container on docker\'s default bridge the same way, and lets it reach the fleet', async () => {
      expect(await tcpConnects('fluxe2edefault', subnet.registry, REGISTRY_PORT)).to.equal(true);
      const before = await ruleHits('DROP', 'docker0', '10.0.0.0/8');
      expect(await tcpConnects('fluxe2edefault', PRIVATE_TARGET, 80)).to.equal(false);
      expect(await ruleHits('DROP', 'docker0', '10.0.0.0/8')).to.be.above(before);
    });

    // A forged packet gets no reply, so only the delivery counter can tell.
    describe('a container that forges its source address', () => {
      const forged = async (name, source, destination, port) => {
        await inApp(name, `ip addr add ${source}/32 dev eth0`);
        try {
          const { packets } = await delivered(destination, port, 'tcp', () => inApp(name, `sh -c 'echo | /bin/busybox nc -s ${source} -w 2 ${destination} ${port}'`));
          return packets;
        } finally {
          await inApp(name, `ip addr del ${source}/32 dev eth0`);
        }
      };

      it('cannot reach the LAN with a public source', async () => {
        expect(await forged('fluxe2eprobe', `${subnet.base}.250`, UPLINK_LAN.privateHost, TCP_PORT)).to.equal(0);
        expect(await forged('fluxe2edefault', `${subnet.base}.251`, UPLINK_LAN.privateHost, TCP_PORT)).to.equal(0);
      });

      it('cannot reach a 172.23 LAN host with another app network\'s source', async () => {
        expect(await forged('fluxe2eprobe', `${OTHER_NETWORK.subnet}.250`, UPLINK_LAN.host, TCP_PORT)).to.equal(0);
      });

      it('cannot reach another app\'s container with that app network\'s source', async () => {
        expect(await forged('fluxe2eprobe', `${OTHER_NETWORK.subnet}.251`, await containerIp('fluxe2eother'), TCP_PORT)).to.equal(0);
      });
    });
  });

  describe('an app FluxOS installs', () => {
    let appName;
    let appPorts;
    let appBridge;
    const container = (component) => `flux${component}_${appName}`;

    before(async function install() {
      this.timeout(300000);
      await pushBusybox(APP_IMAGE_REPO, 'v1', 'busybox', {
        entrypoint: ['/bin/busybox', 'nc', '-lk', '-p', String(TCP_PORT), '-e', '/bin/busybox', 'echo', 'ok'],
      });
      appName = `e2enet${Date.now()}`;
      const component = (name) => ({
        name,
        description: 'listens on its published port',
        repotag: `${REGISTRY_REPO_HOST}/${APP_IMAGE_REPO}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [TCP_PORT],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      });
      const app = await buildSeedableApp({ name: appName, env, compose: [component('front'), component('back')] });
      appPorts = app.spec.compose.map((c) => c.ports[0]);
      const mark = node.getLastEventId();
      // The node's own spawner installs it, as apps land in production: seeded to this node alone, it is the only one that can select it.
      await seedSpawnerApp(env, app, [NODE]);
      await waitForAppInstalled(node, appName, 240000, { afterId: mark });
      appBridge = await bridgeOf(`fluxDockerNetwork_${appName}`);
    });

    it('applies the chain with its network\'s bridge as FluxOS creates the network', async () => {
      const rules = (await chain()).split('\n');
      expect(rules).to.include(`-A DOCKER-USER -i ${appBridge} -o ${appBridge} -j RETURN`);
      expect(rules).to.include(`-A DOCKER-USER -o ${appBridge} -m conntrack --ctstate DNAT -j RETURN`);
      expect(rules).to.include(`-A DOCKER-USER -o ${appBridge} -j DROP`);
    });

    it('connects its components to each other', async () => {
      const back = await containerIp(container('back'));
      expect(await tcpAnswer(container('front'), back, TCP_PORT)).to.equal('ok');
    });

    it('answers another app on its published ports, and not on its containers', async () => {
      expect(await tcpAnswer('fluxe2eprobe', node.ip, appPorts[0])).to.equal('ok');
      await expectTcpBlocked('fluxe2eprobe', await containerIp(container('front')), TCP_PORT);
      await expectTcpBlocked(container('front'), await containerIp('fluxe2epeer'), TCP_PORT);
    });

    it('keeps its containers off the owner\'s LANs', async () => {
      await expectTcpBlocked(container('front'), BRIDGE_LAN.host, TCP_PORT);
      await expectTcpBlocked(container('front'), UPLINK_LAN.privateHost, TCP_PORT);
    });

    it('drops its network\'s rules when FluxOS removes the app', async function removal() {
      this.timeout(180000);
      const auth = await authenticate(node.url, fluxTeamKey());
      const res = await fetch(`${node.url}/apps/appremove/${appName}`, { headers: { zelidauth: auth.zelidauth } });
      await res.text();
      await waitForAppRemoved(node, appName, 120000);
      await waitFor(async () => !(await chain()).includes(appBridge), { timeout: 60000, label: `the chain to drop ${appBridge}` });
    });
  });

  describe('the chain stays', () => {
    it('is left untouched by a FluxOS restart when it already matches', async () => {
      const rules = await chain();
      const afterId = node.getLastEventId();
      await restartFluxos(node.container);
      await waitForBootSettled(node, RULES_TIMEOUT_MS, { afterId });
      const rewritten = node.getEventBuffer().filter((e) => e.id > afterId && e.event === 'firewall:containerEgressApplied');
      expect(rewritten, 'the chain FluxOS read back differed from the one it writes').to.deep.equal([]);
      expect(await chain()).to.equal(rules);
    });

    it('comes back at the next start after the chain is flushed and its jump deleted', async () => {
      const rules = await chain();
      await inNode('iptables -F DOCKER-USER && iptables -D FORWARD -j DOCKER-USER');
      const afterId = node.getLastEventId();
      await restartFluxos(node.container);
      await node.waitForEvent('firewall:containerEgressApplied', () => true, RULES_TIMEOUT_MS, { afterId });
      await waitForBootSettled(node, RULES_TIMEOUT_MS, { afterId });
      expect(await chain()).to.equal(rules);
      expect((await inNode('iptables -C FORWARD -j DOCKER-USER')).exitCode, 'the FORWARD jump').to.equal(0);
      await expectTcpBlocked('fluxe2eprobe', BRIDGE_LAN.host, TCP_PORT);
    });

    it('survives a ufw reload', async () => {
      const rules = await chain();
      expect((await inNode('ufw reload')).exitCode).to.equal(0);
      expect(await chain()).to.equal(rules);
      expect((await inNode('iptables -C FORWARD -j DOCKER-USER')).exitCode, 'the FORWARD jump').to.equal(0);
    });

    it('survives a docker restart', async () => {
      const rules = await chain();
      await restartDockerd(node.container);
      expect(await chain()).to.equal(rules);
      expect((await inNode('iptables -C FORWARD -j DOCKER-USER')).exitCode, 'the FORWARD jump').to.equal(0);
      const started = await inNode('docker start fluxe2eprobe fluxe2epeer fluxe2eotherpublished >/dev/null');
      expect(started.exitCode, started.stderr).to.equal(0);
      await expectTcpBlocked('fluxe2eprobe', BRIDGE_LAN.host, TCP_PORT);
      await expectTcpBlocked('fluxe2eprobe', await containerIp('fluxe2eotherpublished'), TCP_PORT);
      expect(await tcpAnswer('fluxe2eprobe', node.ip, OTHER_PUBLISHED_PORT)).to.equal('ok');
      expect(await tcpAnswer('fluxe2eprobe', await containerIp('fluxe2epeer'), TCP_PORT)).to.equal('ok');
      expect(await tcpConnects('fluxe2eprobe', subnet.registry, REGISTRY_PORT)).to.equal(true);
    });
  });

  // Docker's own filter rules - its isolation chains and, from Docker 28, the raw table's
  // drops of traffic to a container from outside its bridge - are flushed, NAT kept, and
  // the FORWARD policy is ACCEPT: the chain is the only filter left.
  describe('with Docker\'s own isolation rules removed', () => {
    before(async () => {
      const { stdout } = await inNode('docker start fluxe2eother fluxe2esystem fluxe2edefault fluxe2edefaultpeer fluxe2eowner fluxe2eownerpub >/dev/null; '
        + 'iptables -P FORWARD ACCEPT && iptables -F FORWARD && '
        + 'for c in $(iptables -S | awk \'/^-N DOCKER/{print $2}\'); do [ "$c" = DOCKER-USER ] || iptables -F "$c"; done && '
        + 'iptables -I FORWARD -j DOCKER-USER && iptables -t raw -F PREROUTING && iptables -S FORWARD');
      expect(stdout.trim().split('\n'), 'FORWARD holds only the jump to the chain').to.deep.equal(['-P FORWARD ACCEPT', '-A FORWARD -j DOCKER-USER']);
    });

    it('drops an app\'s traffic into another app\'s container itself, on every port and protocol', async () => {
      const other = await containerIp('fluxe2eotherpublished');
      const otherBridge = await bridgeOf(OTHER_NETWORK.name);
      const before = await outHits('DROP', otherBridge);
      await expectTcpBlocked('fluxe2eprobe', other, TCP_PORT);
      await expectTcpBlocked('fluxe2eprobe', other, 53);
      await expectUdpBlocked('fluxe2eprobe', other, UDP_PORT);
      await expectPingBlocked('fluxe2eprobe', other);
      expect(await outHits('DROP', otherBridge)).to.be.above(before);
    });

    // Where Docker's NAT table skips traffic that comes from a container bridge
    // (`-A DOCKER -i <bridge> -j RETURN`, Docker before 29), the connection is answered by
    // docker-proxy on the node and never crosses this chain; elsewhere it is rewritten to
    // the container and passes by the DNAT exception.
    it('still passes another app\'s published port at the node\'s address', async () => {
      const appBridge = await bridgeOf(APP_NETWORK.name);
      const { stdout: nat } = await inNode('iptables -t nat -S DOCKER');
      const proxied = nat.split('\n').includes(`-A DOCKER -i ${appBridge} -j RETURN`);
      const before = await outHits('RETURN', await bridgeOf(OTHER_NETWORK.name), { dnat: true });
      expect(await tcpAnswer('fluxe2eprobe', node.ip, OTHER_PUBLISHED_PORT)).to.equal('ok');
      if (!proxied) expect(await outHits('RETURN', await bridgeOf(OTHER_NETWORK.name), { dnat: true }), 'passed by the DNAT exception').to.be.above(before);
    });

    it('drops traffic into networks FluxOS did not create, the public one included', async () => {
      const ownerPub = await bridgeOf(OWNER_PUBLIC_NETWORK.name);
      const before = await outHits('DROP', ownerPub);
      await expectTcpBlocked('fluxe2eprobe', await containerIp('fluxe2eownerpub'), TCP_PORT);
      expect(await outHits('DROP', ownerPub)).to.be.above(before);
      await expectTcpBlocked('fluxe2eprobe', await containerIp('fluxe2eowner'), TCP_PORT);
      await expectTcpBlocked('fluxe2eowner', await containerIp('fluxe2epeer'), TCP_PORT);
    });

    it('drops docker0 and the system network from apps and apps from them', async () => {
      await expectTcpBlocked('fluxe2eprobe', await containerIp('fluxe2esystem'), TCP_PORT);
      await expectTcpBlocked('fluxe2eprobe', await containerIp('fluxe2edefaultpeer'), TCP_PORT);
      await expectTcpBlocked('fluxe2edefault', await containerIp('fluxe2epeer'), TCP_PORT);
    });

    it('drops a forged source to another app\'s container', async () => {
      await inApp('fluxe2eprobe', `ip addr add ${OTHER_NETWORK.subnet}.252/32 dev eth0`);
      try {
        const target = await containerIp('fluxe2eother');
        const { packets } = await delivered(target, TCP_PORT, 'tcp', () => inApp('fluxe2eprobe', `sh -c 'echo | /bin/busybox nc -s ${OTHER_NETWORK.subnet}.252 -w 2 ${target} ${TCP_PORT}'`));
        expect(packets).to.equal(0);
      } finally {
        await inApp('fluxe2eprobe', `ip addr del ${OTHER_NETWORK.subnet}.252/32 dev eth0`);
      }
    });

    it('still keeps apps off the owner\'s LANs, and lets the same network and the fleet through', async () => {
      await expectTcpBlocked('fluxe2eprobe', BRIDGE_LAN.host, TCP_PORT);
      await expectTcpBlocked('fluxe2eprobe', UPLINK_LAN.host, TCP_PORT);
      expect(await tcpAnswer('fluxe2eprobe', await containerIp('fluxe2epeer'), TCP_PORT)).to.equal('ok');
      expect(await tcpConnects('fluxe2eprobe', subnet.registry, REGISTRY_PORT)).to.equal(true);
    });
  });
});
