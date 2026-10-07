// App containers and the networks around a node: the DOCKER-USER chain that keeps
// an app off the node owner's private networks and link-local addresses, and the
// ordinary traffic it must leave alone.
//
// The containers run on the node's own docker, on networks created as FluxOS
// creates an app's (fluxDockerNetwork_<app>, a 172.23.x.0/24 bridge), from a
// static busybox image so an app can make the connections under test. The rules
// match the bridge a packet comes from, so a bridge made this way is the bridge an
// installed app sits on. The node runs with its firewall on, as nodes do, so an
// app reaches fluxnode.service through the node's own firewall rules. A second
// node, without a firewall, is the world outside: a public client, a client
// behind a router that rewrites its source to a private address, and a UDP
// listener.
//
// A private destination answers nothing on the fleet network, so "blocked" is read
// from the DROP rule's own packet counter rather than from a timeout, and every
// negative sits beside a positive that must succeed through the same chain.
//
// The harness host runs without br_netfilter; 2503 runs these paths with it loaded.
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, restartDockerd, restartFluxos } from '../framework/container.js';
import { pushBusybox } from '../framework/registry-helper.js';
import { REGISTRY_REPO_HOST, REGISTRY_PORT, getSubnetConfig } from '../framework/subnet-config.js';
import { waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODE = 0;
const OUTSIDE = 1;
const IMAGE_REPO = 'e2enettools';
const APP_NETWORK = { name: 'fluxDockerNetwork_e2eprobe', octet: 250 };
const OTHER_NETWORK = { name: 'fluxDockerNetwork_e2eother', octet: 251 };
// Inside 10.0.0.0/8; nothing on the fleet network holds it.
const PRIVATE_TARGET = '10.255.255.1';
const FLUX_NODE_SERVICE = '169.254.43.43:16101';
// Link-local, not on the node: the cloud metadata address.
const LINK_LOCAL_TARGET = '169.254.169.254';
// One address inside each blocked range, none held by anything on the node.
const BLOCKED_TARGETS = {
  '10.0.0.0/8': PRIVATE_TARGET,
  '172.16.0.0/12': '172.31.255.1',
  '192.168.0.0/16': '192.168.255.1',
  '100.64.0.0/10': '100.127.255.1',
  '169.254.0.0/16': LINK_LOCAL_TARGET,
};
// An app's published port, as FluxOS publishes one and opens it in ufw.
const PUBLISHED_PORT = 31999;
const OTHER_PUBLISHED_PORT = 31998;
const UDP_PORT = 9999;
// The address a home router gives the outside client when it rewrites the source
// of a connection into the node.
const ROUTER_SOURCE = '192.168.77.2';
const API_PORT = 16127;
const RULES_TIMEOUT_MS = 180000;

const subnet = getSubnetConfig();

describe('2502 app containers are kept off private networks', function suite() {
  this.timeout(900000);

  let env;
  let node;
  let outside;
  let image;
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

  // Packets the RETURN handing traffic from one app bridge to another to Docker has matched.
  async function bridgeReturnHits() {
    const { stdout } = await inNode('iptables -L DOCKER-USER -v -x -n');
    const row = stdout.split('\n').map((l) => l.trim().split(/\s+/))
      .find((c) => c[2] === 'RETURN' && c[5] === 'br-+' && c[6] === 'br-+');
    if (!row) throw new Error(`no br-+ to br-+ RETURN in DOCKER-USER:\n${stdout}`);
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

  async function tcpConnects(name, host, port) {
    const { exitCode } = await inApp(name, `sh -c 'echo | /bin/busybox nc -w 3 ${host} ${port}'`);
    return exitCode === 0;
  }

  async function tcpAnswer(name, host, port) {
    const { stdout } = await inApp(name, `sh -c 'echo | /bin/busybox nc -w 3 ${host} ${port}'`);
    return stdout.trim();
  }

  const listener = (name, network, extra = '') => `docker run -d --name ${name} --network ${network} ${extra} --entrypoint /bin/busybox ${image} nc -lk -p 8080 -e /bin/busybox echo ok >/dev/null`;

  before(async function hook() {
    env = await createTestEnv({
      hookCtx: this, nodes: 2, firewall: [NODE], tickerAutostart: false,
    });
    node = env.clients[NODE];
    outside = env.clients[OUTSIDE];
    await pushBusybox(IMAGE_REPO, 'v1');
    image = `${REGISTRY_REPO_HOST}/${IMAGE_REPO}:v1`;
    const setup = await inNode([
      'set -e',
      ...[APP_NETWORK, OTHER_NETWORK].map((n) => `docker network create --subnet 172.23.${n.octet}.0/24 --gateway 172.23.${n.octet}.1 ${n.name} >/dev/null`),
      `docker run -d --name fluxe2eprobe --network ${APP_NETWORK.name} ${image} >/dev/null`,
      `docker run -d --name fluxe2espoof --network ${APP_NETWORK.name} --cap-add NET_ADMIN ${image} >/dev/null`,
      `docker run -d --name fluxe2edefault ${image} >/dev/null`,
      listener('fluxe2epeer', APP_NETWORK.name),
      listener('fluxe2eother', OTHER_NETWORK.name),
      listener('fluxe2epublished', APP_NETWORK.name, `-p ${PUBLISHED_PORT}:8080`),
      listener('fluxe2eotherpublished', OTHER_NETWORK.name, `-p ${OTHER_PUBLISHED_PORT}:8080`),
      `ufw allow ${PUBLISHED_PORT}/tcp >/dev/null`,
      `ufw allow ${OTHER_PUBLISHED_PORT}/tcp >/dev/null`,
    ].join('; '));
    expect(setup.exitCode, `app containers did not start: ${setup.stderr}`).to.equal(0);
  });

  after(async () => {
    await env?.teardown();
  });

  describe('the chain', () => {
    // Every app container start at boot waits for boot:settled.
    it('applies the rules before the node lets any app container start', async () => {
      const settled = await waitForBootSettled(node, RULES_TIMEOUT_MS);
      const applied = node.getEventBuffer().find((e) => e.event === 'firewall:containerEgressApplied');
      expect(applied, 'the rules were never applied').to.not.equal(undefined);
      expect(applied.id).to.be.below(settled.id);
    });

    it('matches app traffic by the bridge it comes from, not its source address', async () => {
      const rules = await chain();
      expect(rules).to.include('-A DOCKER-USER -d 10.0.0.0/8 -i br-+ -j DROP');
      expect(rules).to.include('-A DOCKER-USER -d 169.254.0.0/16 -i br-+ -j DROP');
      expect(rules).to.include('-A DOCKER-USER -d 10.0.0.0/8 -i docker0 -j DROP');
      expect(rules.split('\n').filter((rule) => / -s /.test(rule))).to.deep.equal([]);
    });

    it('returns traffic from one container to another to Docker ahead of every drop', async () => {
      const rules = (await chain()).split('\n');
      const firstDrop = rules.findIndex((rule) => rule.endsWith('-j DROP'));
      ['docker0', 'br-+'].forEach((from) => ['docker0', 'br-+'].forEach((to) => {
        const at = rules.indexOf(`-A DOCKER-USER -i ${from} -o ${to} -j RETURN`);
        expect(at, `${from} to ${to}, as iptables lists it`).to.be.above(-1);
        expect(at).to.be.below(firstDrop);
      }));
      expect(rules.filter((rule) => /physdev/.test(rule))).to.deep.equal([]);
    });
  });

  describe('traffic that must pass', () => {
    it('connects an app\'s own containers to each other, over TCP and UDP', async () => {
      const peer = await containerIp('fluxe2epeer');
      expect(await tcpAnswer('fluxe2eprobe', peer, 8080)).to.equal('ok');
      await inNode('docker exec -d fluxe2epeer /bin/busybox sh -c \'/bin/busybox nc -u -l -p 9000 > /tmp/udp-in\'');
      await inApp('fluxe2eprobe', `sh -c 'sleep 1; echo same-network | /bin/busybox nc -u -w 1 ${peer} 9000'`);
      const { stdout } = await inNode('sleep 1; docker exec fluxe2epeer /bin/busybox cat /tmp/udp-in');
      expect(stdout).to.include('same-network');
    });

    it('reaches the fleet over TCP, UDP and ICMP', async () => {
      expect(await tcpConnects('fluxe2eprobe', subnet.registry, REGISTRY_PORT), 'TCP to the fleet registry').to.equal(true);

      await inOutside(`rm -f /tmp/udp-in; nc -u -l ${UDP_PORT} > /tmp/udp-in </dev/null 2>/dev/null & echo $! > /tmp/udp-pid`);
      await inApp('fluxe2eprobe', `sh -c 'sleep 1; echo from-an-app | /bin/busybox nc -u -w 1 ${outside.ip} ${UDP_PORT}'`);
      const { stdout: received } = await inOutside('sleep 1; cat /tmp/udp-in; kill "$(cat /tmp/udp-pid)" 2>/dev/null || true');
      expect(received, 'UDP to a fleet node').to.include('from-an-app');

      const ping = await inApp('fluxe2eprobe', `ping -c 1 -W 3 ${outside.ip}`);
      expect(ping.exitCode, `ICMP to a fleet node: ${ping.stdout}`).to.equal(0);
    });

    it('answers a client outside the node on the app\'s published port', async () => {
      const { stdout } = await inOutside(`echo | nc -w 5 ${node.ip} ${PUBLISHED_PORT}`);
      expect(stdout.trim()).to.equal('ok');
    });

    it('answers a client whose router rewrote its source to a private address', async () => {
      await inOutside(`ip addr add ${ROUTER_SOURCE}/32 dev eth0`);
      await inNode(`ip route add ${ROUTER_SOURCE}/32 via ${outside.ip}`);
      try {
        const dropBefore = await ruleHits('DROP', 'br-+', '192.168.0.0/16');
        const { stdout } = await inOutside(`echo | nc -s ${ROUTER_SOURCE} -w 5 ${node.ip} ${PUBLISHED_PORT}`);
        expect(stdout.trim(), 'the reply to a private address').to.equal('ok');
        expect(await ruleHits('DROP', 'br-+', '192.168.0.0/16')).to.equal(dropBefore);
      } finally {
        await inNode(`ip route del ${ROUTER_SOURCE}/32 via ${outside.ip}`);
        await inOutside(`ip addr del ${ROUTER_SOURCE}/32 dev eth0`);
      }
    });

    it('reaches its own node\'s API and its own published port at the node\'s address', async () => {
      expect(await tcpConnects('fluxe2eprobe', node.ip, API_PORT), 'the node\'s API').to.equal(true);
      expect(await tcpAnswer('fluxe2eprobe', node.ip, PUBLISHED_PORT), 'its own published port').to.equal('ok');
    });

    it('reaches another app\'s published port at the node\'s address', async () => {
      const before = await bridgeReturnHits();
      expect(await tcpAnswer('fluxe2eprobe', node.ip, OTHER_PUBLISHED_PORT)).to.equal('ok');
      expect(await bridgeReturnHits(), 'handed to Docker').to.be.above(before);
    });

    it('lets an app\'s DNS reach a private address over UDP and TCP', async () => {
      const dropBefore = await ruleHits('DROP', 'br-+', '10.0.0.0/8');
      const udpBefore = await ruleHits('RETURN', 'br-+', 'udp dpt:53');
      await inApp('fluxe2eprobe', `sh -c 'echo | /bin/busybox nc -u -w 1 ${PRIVATE_TARGET} 53'`);
      expect(await ruleHits('RETURN', 'br-+', 'udp dpt:53')).to.be.above(udpBefore);
      const tcpBefore = await ruleHits('RETURN', 'br-+', 'tcp dpt:53');
      await tcpConnects('fluxe2eprobe', PRIVATE_TARGET, 53);
      expect(await ruleHits('RETURN', 'br-+', 'tcp dpt:53')).to.be.above(tcpBefore);
      expect(await ruleHits('DROP', 'br-+', '10.0.0.0/8')).to.equal(dropBefore);
    });

    it('still lets an app reach fluxnode.service on the node', async () => {
      const before = await ruleHits('DROP', 'br-+', '169.254.0.0/16');
      const [host, port] = FLUX_NODE_SERVICE.split(':');
      expect(await tcpConnects('fluxe2eprobe', host, port)).to.equal(true);
      expect(await ruleHits('DROP', 'br-+', '169.254.0.0/16')).to.equal(before);
    });
  });

  describe('traffic that must not pass', () => {
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

    it('drops a container that forges a public source address', async () => {
      const forged = `${subnet.base}.250`;
      await inApp('fluxe2espoof', `ip addr add ${forged}/32 dev eth0`);
      // Counts the forged packet arriving, so the drop below is of that packet.
      await inNode(`iptables -t mangle -I PREROUTING -s ${forged} -d ${PRIVATE_TARGET} -j RETURN`);
      try {
        const before = await ruleHits('DROP', 'br-+', '10.0.0.0/8');
        await inApp('fluxe2espoof', `sh -c 'echo | /bin/busybox nc -s ${forged} -w 3 ${PRIVATE_TARGET} 80'`);
        const { stdout } = await inNode(`iptables -t mangle -L PREROUTING -v -x -n | grep ${forged}`);
        expect(Number(stdout.trim().split(/\s+/)[0]), 'forged packets seen').to.be.above(0);
        expect(await ruleHits('DROP', 'br-+', '10.0.0.0/8')).to.be.above(before);
      } finally {
        await inNode(`iptables -t mangle -D PREROUTING -s ${forged} -d ${PRIVATE_TARGET} -j RETURN`);
      }
    });

    it('keeps one app\'s network from another, through Docker\'s own isolation', async () => {
      const before = await bridgeReturnHits();
      const dropBefore = await ruleHits('DROP', 'br-+', '172.16.0.0/12');
      expect(await tcpConnects('fluxe2eprobe', await containerIp('fluxe2eother'), 8080)).to.equal(false);
      expect(await bridgeReturnHits(), 'handed to Docker').to.be.above(before);
      expect(await ruleHits('DROP', 'br-+', '172.16.0.0/12'), 'never reaches the private-range drop').to.equal(dropBefore);
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
      const before = await ruleHits('DROP', 'br-+', '10.0.0.0/8');
      expect(await tcpConnects('fluxe2eprobe', PRIVATE_TARGET, 80)).to.equal(false);
      expect(await ruleHits('DROP', 'br-+', '10.0.0.0/8')).to.be.above(before);
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
      expect((await inNode('docker start fluxe2eprobe >/dev/null')).exitCode).to.equal(0);
      const before = await ruleHits('DROP', 'br-+', '10.0.0.0/8');
      expect(await tcpConnects('fluxe2eprobe', PRIVATE_TARGET, 80)).to.equal(false);
      expect(await ruleHits('DROP', 'br-+', '10.0.0.0/8')).to.be.above(before);
      expect(await tcpConnects('fluxe2eprobe', subnet.registry, REGISTRY_PORT)).to.equal(true);
    });
  });
});
