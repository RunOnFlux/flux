// App containers on a node whose kernel has br_netfilter loaded: traffic between
// an app's own containers then passes through iptables, and the DOCKER-USER chain
// must let it through by the network's own exception while still keeping app
// networks apart, a network FluxOS did not create closed, and every app off the
// owner's networks. An app installed through FluxOS shows the chain is applied
// with its network before its containers need it.
//
// The module is kernel-wide, so loading it changes every docker bridge on the
// harness host. The suite runs only when E2E_HOST_KERNEL=1 and, with it, on a host
// running nothing else: SUITE_GLOB='tests/2503-*.js' E2E_HOST_KERNEL=1. It loads
// the module with the runner's sudo and unloads only what it loaded.
import { execFileSync } from 'node:child_process';
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, restartFluxos } from '../framework/container.js';
import { pushBusybox } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, seedSpawnerApp } from '../framework/reconciler-suite.js';
import { REGISTRY_REPO_HOST, REGISTRY_PORT, getSubnetConfig } from '../framework/subnet-config.js';
import { waitForAppInstalled, waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODE = 0;
const IMAGE_REPO = 'e2enettools';
const APP_IMAGE_REPO = 'e2enetapp';
const APP_NETWORK = { name: 'fluxDockerNetwork_e2eprobe', subnet: '172.23.250' };
const OTHER_NETWORK = { name: 'fluxDockerNetwork_e2eother', subnet: '172.23.251' };
const OWNER_NETWORK = { name: 'e2eownernet', subnet: '172.30.250' };
const OTHER_PUBLISHED_PORT = 31998;
const PRIVATE_TARGET = '10.255.255.1';
const HOST_BRIDGE = 'br-e2elan';
const BRIDGE_LAN = { gateway: '172.23.200.1', host: '172.23.200.10' };
const TCP_PORT = 8080;
const BUSYBOX = '/usr/local/bin/busybox';
const MODULES = ['br_netfilter'];

const subnet = getSubnetConfig();

const hostModulesLoaded = () => {
  const lsmod = execFileSync('lsmod', { encoding: 'utf8' });
  return MODULES.filter((m) => lsmod.split('\n').some((line) => line.startsWith(`${m} `)));
};

describe('2503 app containers on a node with br_netfilter loaded', function suite() {
  this.timeout(900000);

  let env;
  let node;
  let loadedBefore = [];
  dumpLogsOnFailure(() => env);

  const inNode = async (command) => execInContainer(node.container, command);
  const inApp = async (name, command) => inNode(`docker exec ${name} /bin/busybox ${command}`);

  async function ruleHits(...words) {
    const { stdout } = await inNode('iptables -L DOCKER-USER -v -x -n');
    const line = stdout.split('\n').find((l) => words.every((w) => l.includes(w)));
    if (!line) throw new Error(`no DOCKER-USER rule with ${words.join(' ')}:\n${stdout}`);
    return Number(line.trim().split(/\s+/)[0]);
  }

  // Packets a rule naming a bridge has matched: `-i <in> -o <out> -j <target>`, with
  // `*` for either side the rule leaves open.
  async function bridgeHits(target, inBridge, outBridge) {
    const { stdout } = await inNode('iptables -L DOCKER-USER -v -x -n');
    const row = stdout.split('\n').map((l) => l.trim().split(/\s+/))
      .find((c) => c[2] === target && c[5] === inBridge && c[6] === outBridge && c.length === 9);
    if (!row) throw new Error(`no DOCKER-USER ${target} ${inBridge} -> ${outBridge}:\n${stdout}`);
    return Number(row[0]);
  }

  async function bridgeOf(network) {
    const { stdout } = await inNode(`docker network inspect -f '{{.Id}}' ${network}`);
    return `br-${stdout.trim().slice(0, 12)}`;
  }

  async function containerIp(name) {
    const { stdout } = await inNode(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${name}`);
    return stdout.trim();
  }

  async function tcpAnswer(name, host, port) {
    const { stdout } = await inApp(name, `sh -c 'echo | /bin/busybox nc -w 3 ${host} ${port}'`);
    return stdout.trim();
  }

  // Packets that left the node towards a destination while `action` ran.
  async function delivered(destination, port, action) {
    const match = `-d ${destination} -p tcp --dport ${port}`;
    await inNode(`iptables -t mangle -I POSTROUTING ${match} -m comment --comment e2e-delivered -j RETURN`);
    try {
      const result = await action();
      const { stdout } = await inNode('iptables -t mangle -L POSTROUTING -v -x -n');
      return { result, packets: Number(stdout.split('\n').find((l) => l.includes('e2e-delivered')).trim().split(/\s+/)[0]) };
    } finally {
      await inNode(`iptables -t mangle -D POSTROUTING ${match} -m comment --comment e2e-delivered -j RETURN`);
    }
  }

  async function expectTcpBlocked(name, host, port) {
    const { result, packets } = await delivered(host, port, () => tcpAnswer(name, host, port));
    expect(result, `${name} was answered by ${host}:${port}`).to.equal('');
    expect(packets, `packets that left for ${host}:${port}`).to.equal(0);
  }

  before(async function hook() {
    if (process.env.E2E_HOST_KERNEL !== '1') this.skip();
    loadedBefore = hostModulesLoaded();
    execFileSync('sudo', ['-n', 'modprobe', 'br_netfilter']);

    env = await createTestEnv({
      hookCtx: this, nodes: 3, firewall: [NODE], tickerAutostart: false,
    });
    node = env.clients[NODE];
    await bootAndPeer(env);
    await pushBusybox(IMAGE_REPO, 'v1');
    const image = `${REGISTRY_REPO_HOST}/${IMAGE_REPO}:v1`;
    const listener = (name, network, extra = '') => `docker run -d --name ${name} --network ${network} ${extra} --entrypoint /bin/busybox ${image} nc -lk -p ${TCP_PORT} -e /bin/busybox echo ok >/dev/null`;
    const network = (n) => `docker network create --subnet ${n.subnet}.0/24 --gateway ${n.subnet}.1 ${n.name} >/dev/null`;
    const setup = await inNode([
      'set -e',
      'sysctl -qw net.bridge.bridge-nf-call-iptables=1',
      `cid=$(docker create ${image}); docker cp "$cid:/bin/busybox" ${BUSYBOX}; docker rm "$cid" >/dev/null`,
      ...[APP_NETWORK, OTHER_NETWORK, OWNER_NETWORK].map(network),
      `docker run -d --name fluxe2eprobe --network ${APP_NETWORK.name} ${image} >/dev/null`,
      listener('fluxe2epeer', APP_NETWORK.name),
      listener('fluxe2eother', OTHER_NETWORK.name, `-p ${OTHER_PUBLISHED_PORT}:${TCP_PORT}`),
      `docker run -d --name fluxe2eowner --network ${OWNER_NETWORK.name} ${image} >/dev/null`,
      listener('fluxe2eownerpeer', OWNER_NETWORK.name),
      `ufw allow ${OTHER_PUBLISHED_PORT}/tcp >/dev/null`,
      'ip netns add lanb',
      `ip link add ${HOST_BRIDGE} type bridge && ip addr add ${BRIDGE_LAN.gateway}/24 dev ${HOST_BRIDGE} && ip link set ${HOST_BRIDGE} up`,
      `ip link add vlanb0 type veth peer name vlanb1 && ip link set vlanb0 master ${HOST_BRIDGE} up && ip link set vlanb1 netns lanb`,
      `ip -n lanb addr add ${BRIDGE_LAN.host}/24 dev vlanb1 && ip -n lanb link set vlanb1 up && ip -n lanb route add default via ${BRIDGE_LAN.gateway}`,
      `ip netns exec lanb setsid ${BUSYBOX} nc -lk -p ${TCP_PORT} -e ${BUSYBOX} echo ok >/dev/null 2>&1 &`,
    ].join('\n'));
    expect(setup.exitCode, `setup failed: ${setup.stderr}`).to.equal(0);

    // FluxOS's boot applies the chain with the networks that exist now.
    const afterId = node.getLastEventId();
    await restartFluxos(node.container);
    await waitForBootSettled(node, 180000, { afterId });
  });

  after(async () => {
    await env?.teardown();
    const loadedNow = hostModulesLoaded();
    const ours = MODULES.filter((m) => loadedNow.includes(m) && !loadedBefore.includes(m));
    // rmmod, not modprobe -r: modprobe -r also unloads the bridge module once
    // nothing holds it, which deletes every bridge on the host, docker0 included.
    if (ours.length) execFileSync('sudo', ['-n', 'rmmod', ...ours]);
  });

  it('runs with bridged traffic passing through iptables in the node', async () => {
    const { stdout } = await inNode('cat /proc/sys/net/bridge/bridge-nf-call-iptables');
    expect(stdout.trim()).to.equal('1');
  });

  it('the canaries: the node reaches every listener a blocked case aims at', async () => {
    // eslint-disable-next-line no-restricted-syntax
    for (const target of [await containerIp('fluxe2eother'), await containerIp('fluxe2eownerpeer'), BRIDGE_LAN.host]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await inNode(`echo | ${BUSYBOX} nc -w 3 ${target} ${TCP_PORT}`)).stdout.trim(), target).to.equal('ok');
    }
  });

  it('connects an app\'s own containers to each other, by its network\'s own exception', async () => {
    const bridge = await bridgeOf(APP_NETWORK.name);
    const before = await bridgeHits('RETURN', bridge, bridge);
    expect(await tcpAnswer('fluxe2eprobe', await containerIp('fluxe2epeer'), TCP_PORT)).to.equal('ok');
    expect(await bridgeHits('RETURN', bridge, bridge), 'bridged packets let through by the network\'s exception').to.be.above(before);
  });

  it('reaches another app\'s published port at the node\'s address', async () => {
    expect(await tcpAnswer('fluxe2eprobe', node.ip, OTHER_PUBLISHED_PORT)).to.equal('ok');
  });

  it('keeps one app\'s network from another', async () => {
    await expectTcpBlocked('fluxe2eprobe', await containerIp('fluxe2eother'), TCP_PORT);
  });

  it('gives a network FluxOS did not create no exception: its own containers do not reach each other', async () => {
    const bridge = await bridgeOf(OWNER_NETWORK.name);
    const before = await bridgeHits('DROP', '*', bridge);
    expect(await tcpAnswer('fluxe2eowner', await containerIp('fluxe2eownerpeer'), TCP_PORT)).to.equal('');
    expect(await bridgeHits('DROP', '*', bridge)).to.be.above(before);
  });

  it('keeps an app off the owner\'s LAN behind a host bridge named like a docker one', async () => {
    await expectTcpBlocked('fluxe2eprobe', BRIDGE_LAN.host, TCP_PORT);
  });

  it('still drops an app\'s connection to a private network, and passes one to the fleet', async () => {
    const { exitCode } = await inApp('fluxe2eprobe', `sh -c 'echo | /bin/busybox nc -w 3 ${subnet.registry} ${REGISTRY_PORT}'`);
    expect(exitCode, 'the fleet registry must be reachable').to.equal(0);
    const before = await ruleHits('DROP', 'br-+', '10.0.0.0/8');
    expect(await tcpAnswer('fluxe2eprobe', PRIVATE_TARGET, 80)).to.equal('');
    expect(await ruleHits('DROP', 'br-+', '10.0.0.0/8')).to.be.above(before);
  });

  // With bridged traffic in iptables, an app's components reach each other only once
  // the chain holds their network's exception, so they answer each other as soon as
  // the install has started them.
  it('connects the components of an app FluxOS installs, as soon as they run', async function installed() {
    this.timeout(300000);
    await pushBusybox(APP_IMAGE_REPO, 'v1', 'busybox', {
      entrypoint: ['/bin/busybox', 'nc', '-lk', '-p', String(TCP_PORT), '-e', '/bin/busybox', 'echo', 'ok'],
    });
    const appName = `e2enet${Date.now()}`;
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
    const mark = node.getLastEventId();
    // The node's own spawner installs it, as apps land in production: seeded to this node alone, it is the only one that can select it.
    await seedSpawnerApp(env, app, [NODE]);
    await waitForAppInstalled(node, appName, 240000, { afterId: mark });

    const bridge = await bridgeOf(`fluxDockerNetwork_${appName}`);
    const before = await bridgeHits('RETURN', bridge, bridge);
    expect(await tcpAnswer(`fluxfront_${appName}`, await containerIp(`fluxback_${appName}`), TCP_PORT)).to.equal('ok');
    expect(await bridgeHits('RETURN', bridge, bridge)).to.be.above(before);
  });
});
