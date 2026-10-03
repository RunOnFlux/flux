// App containers and the networks around a node: the DOCKER-USER chain that keeps
// an app off the node owner's private networks and link-local addresses.
//
// The containers run on the node's own docker, on networks created as FluxOS
// creates an app's (fluxDockerNetwork_<app>, a 172.23.x.0/24 bridge), from a
// static busybox image so an app can make the connections under test. The rules
// match the bridge a packet comes from, so a bridge made this way is the bridge an
// installed app sits on.
//
// A private destination answers nothing on the fleet network, so "blocked" is read
// from the DROP rule's own packet counter rather than from a timeout, and every
// negative sits beside a positive that must succeed through the same chain.
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { pushBusybox } from '../framework/registry-helper.js';
import { REGISTRY_REPO_HOST, REGISTRY_PORT, getSubnetConfig } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODE = 0;
const IMAGE_REPO = 'e2enettools';
const APP_NETWORK = { name: 'fluxDockerNetwork_e2eprobe', octet: 250 };
const OTHER_NETWORK = { name: 'fluxDockerNetwork_e2eother', octet: 251 };
// Inside 10.0.0.0/8; nothing on the fleet network holds it.
const PRIVATE_TARGET = '10.255.255.1';
const FLUX_NODE_SERVICE = '169.254.43.43:16101';
// Logged by the app startup manager just before it starts any app container.
const RECONCILING_APPS = 'appStartupManager - Daemon, DB, and node confirmed, reconciling apps';

const subnet = getSubnetConfig();

describe('2502 app containers are kept off private networks', function suite() {
  this.timeout(600000);

  let env;
  let node;
  dumpLogsOnFailure(() => env);

  const inNode = async (command) => execInContainer(node.container, command);
  const inApp = async (name, command) => inNode(`docker exec ${name} /bin/busybox ${command}`);

  // Packets a DOCKER-USER rule has matched, found by the words of its listing.
  async function ruleHits(...words) {
    const { stdout } = await inNode('iptables -L DOCKER-USER -v -x -n');
    const line = stdout.split('\n').find((l) => words.every((w) => l.includes(w)));
    if (!line) throw new Error(`no DOCKER-USER rule with ${words.join(' ')}:\n${stdout}`);
    return Number(line.trim().split(/\s+/)[0]);
  }

  async function containerIp(name) {
    const { stdout } = await inNode(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${name}`);
    return stdout.trim();
  }

  async function tcpConnects(name, host, port) {
    const { exitCode } = await inApp(name, `sh -c 'echo | /bin/busybox nc -w 3 ${host} ${port}'`);
    return exitCode === 0;
  }

  before(async function hook() {
    // An established node, so its app startup manager reaches the point where it
    // would start apps without waiting out the block fallback.
    env = await createTestEnv({
      hookCtx: this, nodes: 1, syncedNodes: [NODE], tickerAutostart: false,
    });
    node = env.clients[NODE];
    await pushBusybox(IMAGE_REPO, 'v1');
    const image = `${REGISTRY_REPO_HOST}/${IMAGE_REPO}:v1`;
    const setup = await inNode([
      'set -e',
      ...[APP_NETWORK, OTHER_NETWORK].map((n) => `docker network create --subnet 172.23.${n.octet}.0/24 --gateway 172.23.${n.octet}.1 ${n.name} >/dev/null`),
      `docker run -d --name fluxe2eprobe --network ${APP_NETWORK.name} ${image} >/dev/null`,
      `docker run -d --name fluxe2epeer --network ${APP_NETWORK.name} --entrypoint /bin/busybox ${image} nc -lk -p 8080 -e /bin/busybox echo ok >/dev/null`,
      `docker run -d --name fluxe2eother --network ${OTHER_NETWORK.name} --entrypoint /bin/busybox ${image} nc -lk -p 8080 -e /bin/busybox echo ok >/dev/null`,
    ].join('; '));
    expect(setup.exitCode, `app containers did not start: ${setup.stderr}`).to.equal(0);
  });

  after(async () => {
    await env?.teardown();
  });

  it('applies the rules before the app startup manager starts any app', async () => {
    await waitFor(() => env.nodeHasLog(NODE, RECONCILING_APPS), {
      timeout: 180000, interval: 2000, label: 'the app startup manager reaching its app reconcile',
    });
    const lines = env.nodeLogLines(NODE);
    const applied = lines.findIndex((l) => l.includes('IPTABLES: DOCKER-USER rules applied'));
    const reconciling = lines.findIndex((l) => l.includes(RECONCILING_APPS));
    expect(applied, 'the rules were never applied').to.be.at.least(0);
    expect(applied).to.be.below(reconciling);
  });

  it('matches app traffic by the bridge it comes from, not its source address', async () => {
    const { stdout } = await inNode('iptables -S DOCKER-USER');
    expect(stdout).to.include('-A DOCKER-USER -d 10.0.0.0/8 -i br-+ -j DROP');
    expect(stdout).to.include('-A DOCKER-USER -d 169.254.0.0/16 -i br-+ -j DROP');
    expect(stdout.split('\n').filter((rule) => / -s /.test(rule))).to.deep.equal([]);
  });

  it('drops an app\'s connection to a private network, and passes one to the fleet', async () => {
    expect(await tcpConnects('fluxe2eprobe', subnet.registry, REGISTRY_PORT), 'the fleet registry must be reachable').to.equal(true);
    const before = await ruleHits('DROP', 'br-+', '10.0.0.0/8');
    expect(await tcpConnects('fluxe2eprobe', PRIVATE_TARGET, 80)).to.equal(false);
    expect(await ruleHits('DROP', 'br-+', '10.0.0.0/8')).to.be.above(before);
  });

  it('lets an app\'s DNS reach a private address', async () => {
    const dnsBefore = await ruleHits('RETURN', 'br-+', 'udp dpt:53');
    const dropBefore = await ruleHits('DROP', 'br-+', '10.0.0.0/8');
    await inApp('fluxe2eprobe', `sh -c 'echo | /bin/busybox nc -u -w 1 ${PRIVATE_TARGET} 53'`);
    expect(await ruleHits('RETURN', 'br-+', 'udp dpt:53')).to.be.above(dnsBefore);
    expect(await ruleHits('DROP', 'br-+', '10.0.0.0/8')).to.equal(dropBefore);
  });

  it('still lets an app reach fluxnode.service on the node', async () => {
    const before = await ruleHits('DROP', 'br-+', '169.254.0.0/16');
    const [host, port] = FLUX_NODE_SERVICE.split(':');
    expect(await tcpConnects('fluxe2eprobe', host, port)).to.equal(true);
    expect(await ruleHits('DROP', 'br-+', '169.254.0.0/16')).to.equal(before);
  });

  it('keeps one app\'s network from another, and not an app from its own', async () => {
    expect(await tcpConnects('fluxe2eprobe', await containerIp('fluxe2epeer'), 8080), 'the same network must connect').to.equal(true);
    expect(await tcpConnects('fluxe2eprobe', await containerIp('fluxe2eother'), 8080)).to.equal(false);
  });
});
