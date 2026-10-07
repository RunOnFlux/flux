// App containers on a node whose kernel has br_netfilter loaded: traffic between
// an app's own containers is then switched through iptables, and the DOCKER-USER
// chain must pass it while still keeping app networks apart and off private ones.
//
// The module is kernel-wide, so loading it changes every docker bridge on the
// harness host. The suite runs only when E2E_HOST_KERNEL=1 and, with it, on a host
// running nothing else: SUITE_GLOB='tests/2503-*.js' E2E_HOST_KERNEL=1. It loads
// the module with the runner's sudo and unloads whatever it loaded.
import { execFileSync } from 'node:child_process';
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { pushBusybox } from '../framework/registry-helper.js';
import { REGISTRY_REPO_HOST, REGISTRY_PORT, getSubnetConfig } from '../framework/subnet-config.js';
import { waitForBootSettled } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const NODE = 0;
const IMAGE_REPO = 'e2enettools';
const APP_NETWORK = { name: 'fluxDockerNetwork_e2eprobe', octet: 250 };
const OTHER_NETWORK = { name: 'fluxDockerNetwork_e2eother', octet: 251 };
const PRIVATE_TARGET = '10.255.255.1';
const MODULES = ['br_netfilter', 'xt_physdev'];

const subnet = getSubnetConfig();

const hostModulesLoaded = () => {
  const lsmod = execFileSync('lsmod', { encoding: 'utf8' });
  return MODULES.filter((m) => lsmod.split('\n').some((line) => line.startsWith(`${m} `)));
};

describe('2503 app containers on a node with br_netfilter loaded', function suite() {
  this.timeout(600000);

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

  async function containerIp(name) {
    const { stdout } = await inNode(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${name}`);
    return stdout.trim();
  }

  async function tcpAnswer(name, host, port) {
    const { stdout } = await inApp(name, `sh -c 'echo | /bin/busybox nc -w 3 ${host} ${port}'`);
    return stdout.trim();
  }

  before(async function hook() {
    if (process.env.E2E_HOST_KERNEL !== '1') this.skip();
    loadedBefore = hostModulesLoaded();
    execFileSync('sudo', ['-n', 'modprobe', 'br_netfilter']);

    env = await createTestEnv({
      hookCtx: this, nodes: 1, firewall: [NODE], tickerAutostart: false,
    });
    node = env.clients[NODE];
    await waitForBootSettled(node, 180000);
    await pushBusybox(IMAGE_REPO, 'v1');
    const image = `${REGISTRY_REPO_HOST}/${IMAGE_REPO}:v1`;
    const listener = (name, network) => `docker run -d --name ${name} --network ${network} --entrypoint /bin/busybox ${image} nc -lk -p 8080 -e /bin/busybox echo ok >/dev/null`;
    const setup = await inNode([
      'set -e',
      'sysctl -qw net.bridge.bridge-nf-call-iptables=1',
      ...[APP_NETWORK, OTHER_NETWORK].map((n) => `docker network create --subnet 172.23.${n.octet}.0/24 --gateway 172.23.${n.octet}.1 ${n.name} >/dev/null`),
      `docker run -d --name fluxe2eprobe --network ${APP_NETWORK.name} ${image} >/dev/null`,
      listener('fluxe2epeer', APP_NETWORK.name),
      listener('fluxe2eother', OTHER_NETWORK.name),
    ].join('; '));
    expect(setup.exitCode, `app containers did not start: ${setup.stderr}`).to.equal(0);
  });

  after(async () => {
    await env?.teardown();
    const loadedNow = hostModulesLoaded();
    const ours = MODULES.filter((m) => loadedNow.includes(m) && !loadedBefore.includes(m));
    if (ours.length) execFileSync('sudo', ['-n', 'modprobe', '-r', ...ours]);
  });

  it('runs with bridged traffic passing through iptables in the node', async () => {
    const { stdout } = await inNode('cat /proc/sys/net/bridge/bridge-nf-call-iptables');
    expect(stdout.trim()).to.equal('1');
  });

  it('connects an app\'s own containers to each other through the physdev RETURN', async () => {
    const before = await ruleHits('RETURN', 'PHYSDEV');
    const dropBefore = await ruleHits('DROP', 'br-+', '172.16.0.0/12');
    expect(await tcpAnswer('fluxe2eprobe', await containerIp('fluxe2epeer'), 8080)).to.equal('ok');
    expect(await ruleHits('RETURN', 'PHYSDEV'), 'bridged packets returned').to.be.above(before);
    expect(await ruleHits('DROP', 'br-+', '172.16.0.0/12')).to.equal(dropBefore);
  });

  it('still keeps one app\'s network from another', async () => {
    const before = await ruleHits('DROP', 'br-+', '172.16.0.0/12');
    expect(await tcpAnswer('fluxe2eprobe', await containerIp('fluxe2eother'), 8080)).to.equal('');
    expect(await ruleHits('DROP', 'br-+', '172.16.0.0/12')).to.be.above(before);
  });

  it('still drops an app\'s connection to a private network, and passes one to the fleet', async () => {
    const { exitCode } = await inApp('fluxe2eprobe', `sh -c 'echo | /bin/busybox nc -w 3 ${subnet.registry} ${REGISTRY_PORT}'`);
    expect(exitCode, 'the fleet registry must be reachable').to.equal(0);
    const before = await ruleHits('DROP', 'br-+', '10.0.0.0/8');
    expect(await tcpAnswer('fluxe2eprobe', PRIVATE_TARGET, 80)).to.equal('');
    expect(await ruleHits('DROP', 'br-+', '10.0.0.0/8')).to.be.above(before);
  });
});
