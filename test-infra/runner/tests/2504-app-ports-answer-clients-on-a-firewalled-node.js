// An app's published port answers every client on a node whose firewall is on:
// IPv4 and IPv6 clients outside the node, and a container on the node connecting
// to it at the node's own address.
//
// Docker forwards an IPv4 connection from outside to a published port ahead of
// ufw's inbound rules, but answers an IPv6 one, and on some Docker releases a
// container's connection at the node's own address, through docker-proxy on the
// node itself, behind them. FluxOS opens each app port with `allow <port>` when it
// installs the app, re-applies it at every start, and deletes it when it removes
// the app.
//
// The fleet network carries no IPv6, so the node and the client outside it are
// given addresses of their own on it before anything is published: Docker binds a
// published port on IPv6 only where the host has IPv6 when the container starts.
// The canary is a port published by hand, with no rule: it must be bound on IPv6
// and answer IPv4 and not IPv6, or ufw is not what decides IPv6 here and the rest
// proves nothing.
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, restartFluxos } from '../framework/container.js';
import { pushBusybox } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitForAppRemoved, waitForBootSettled } from '../framework/wait.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';

const NODE = 0;
const OUTSIDE = 1;
const IMAGE_REPO = 'e2ev6listener';
const LISTEN_PORT = 8080;
// Below the harness's allocation range, so no app is given it.
const CANARY_PORT = 31997;
const V6_PREFIX = 'fd25:2504::';
const NODE_V6 = `${V6_PREFIX}1`;
const OUTSIDE_V6 = `${V6_PREFIX}2`;

describe('2504 app ports answer every client on a firewalled node', function suite() {
  this.timeout(600000);

  let env;
  let node;
  let outside;
  let image;
  let appName;
  let appPort;
  dumpLogsOnFailure(() => env);

  const inNode = async (command) => execInContainer(node.container, command);
  const inOutside = async (command) => execInContainer(outside.container, command);
  const ncSaid = ({ exitCode, stderr }) => `nc exit ${exitCode}: ${(stderr || '').trim()}`;
  // What the listener behind a port says to a client outside the node.
  const answerFrom = async (address, port) => {
    const answer = await inOutside(`nc -w 5 ${address} ${port} </dev/null`);
    return { said: answer.stdout.trim(), why: ncSaid(answer) };
  };
  // The rules ufw holds for a port, by family, as `ufw status` lists them. `ufw show
  // added` prints an IPv6-only allow the same as one for both families.
  const portRules = async (port) => {
    const lines = (await inNode('ufw status; true')).stdout.split('\n').map((line) => line.trim());
    return {
      ipv4: lines.filter((line) => new RegExp(`^${port}\\s+ALLOW`).test(line)),
      ipv6: lines.filter((line) => new RegExp(`^${port} \\(v6\\)\\s+ALLOW\\s+Anywhere \\(v6\\)$`).test(line)),
    };
  };

  const addIpv6 = (address) => [
    'sysctl -qw net.ipv6.conf.all.disable_ipv6=0 net.ipv6.conf.eth0.disable_ipv6=0',
    `ip -6 addr add ${address}/64 dev eth0 nodad`,
  ].join(' && ');

  before(async function hook() {
    env = await createTestEnv({
      hookCtx: this, nodes: 3, firewall: [NODE], tickerAutostart: false,
    });
    node = env.clients[NODE];
    outside = env.clients[OUTSIDE];
    for (const [client, address] of [[node, NODE_V6], [outside, OUTSIDE_V6]]) {
      // eslint-disable-next-line no-await-in-loop
      const added = await execInContainer(client.container, addIpv6(address));
      expect(added.exitCode, `IPv6 address on ${client.container}: ${added.stderr}`).to.equal(0);
    }
    await bootAndPeer(env);

    await pushBusybox(IMAGE_REPO, 'v1', 'busybox', {
      entrypoint: ['/bin/busybox', 'nc', '-lk', '-p', String(LISTEN_PORT), '-e', '/bin/busybox', 'echo', 'ok'],
    });
    image = `${REGISTRY_REPO_HOST}/${IMAGE_REPO}:v1`;

    const canary = await inNode(`docker run -d --name e2ev6canary -p ${CANARY_PORT}:${LISTEN_PORT} ${image} >/dev/null`);
    expect(canary.exitCode, `canary did not start: ${canary.stderr}`).to.equal(0);

    appName = `e2ev6app${Date.now()}`;
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
        description: 'listens on its published port',
        repotag: image,
        ports: [],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [LISTEN_PORT],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });
    [appPort] = app.spec.compose[0].ports;
    await installOnNodes(env, app, [NODE]);
  });

  after(async () => {
    await env?.teardown();
  });

  it('filters IPv6 to a port published with no rule, and not IPv4', async () => {
    const listening = (await inNode('ss -Hltn')).stdout;
    expect(listening, 'the port bound on IPv6').to.match(new RegExp(`\\[::\\]:${CANARY_PORT}\\s`));

    const ipv4 = await answerFrom(node.ip, CANARY_PORT);
    expect(ipv4.said, ipv4.why).to.equal('ok');
    const ipv6 = await answerFrom(NODE_V6, CANARY_PORT);
    expect(ipv6.said, `an IPv6 client was answered: ${ipv6.why}`).to.equal('');
  });

  // What a container on the node is answered on a port at the node's own address.
  const answerFromAContainer = async (port) => {
    const { stdout, exitCode, stderr } = await inNode(`docker run --rm --entrypoint /bin/busybox ${image} sh -c 'echo | /bin/busybox nc -w 3 ${node.ip} ${port}'`);
    return { said: stdout.trim(), why: `exit ${exitCode}: ${(stderr || '').trim()}` };
  };

  it('opens an installed app\'s port to every client, by one rule for both families', async () => {
    const rules = await portRules(appPort);
    expect(rules.ipv4, 'the IPv4 half of the port\'s rule').to.have.length(1);
    expect(rules.ipv6, 'the IPv6 half of the port\'s rule').to.have.length(1);

    const ipv6 = await answerFrom(NODE_V6, appPort);
    expect(ipv6.said, `an IPv6 client outside the node: ${ipv6.why}`).to.equal('ok');
    const ipv4 = await answerFrom(node.ip, appPort);
    expect(ipv4.said, `an IPv4 client outside the node: ${ipv4.why}`).to.equal('ok');
    const fromContainer = await answerFromAContainer(appPort);
    expect(fromContainer.said, `a container on the node, at the node's address: ${fromContainer.why}`).to.equal('ok');
  });

  // FluxOS opens a port for a moment to test it from outside (before installing an app,
  // and in its availability check) with `allow proto tcp from 0.0.0.0/0 to any port
  // <port>`. ufw counts a rule naming no protocol as the same rule as the matching half
  // of an app port's `allow <port>`, so a test that opened and deleted one would delete
  // that half: the canary shows it on a port no app holds.
  it('keeps the app\'s rule whole through a port test on its port', async () => {
    const canary = await inNode([
      `ufw allow ${CANARY_PORT} >/dev/null`,
      `ufw allow from 0.0.0.0/0 to any port ${CANARY_PORT} >/dev/null`,
      `ufw delete allow from 0.0.0.0/0 to any port ${CANARY_PORT} >/dev/null`,
    ].join(' && '));
    expect(canary.exitCode, canary.stderr).to.equal(0);
    expect((await portRules(CANARY_PORT)).ipv4, 'the canary: a delete naming no protocol takes the IPv4 half').to.deep.equal([]);
    await inNode(`ufw delete allow ${CANARY_PORT} >/dev/null`);

    const tested = await inNode([
      `ufw allow proto tcp from 0.0.0.0/0 to any port ${appPort} >/dev/null`,
      `ufw delete allow proto tcp from 0.0.0.0/0 to any port ${appPort} >/dev/null`,
    ].join(' && '));
    expect(tested.exitCode, tested.stderr).to.equal(0);
    const rules = await portRules(appPort);
    expect(rules.ipv4, 'the IPv4 half after the port test').to.have.length(1);
    expect(rules.ipv6, 'the IPv6 half after the port test').to.have.length(1);
    const fromContainer = await answerFromAContainer(appPort);
    expect(fromContainer.said, fromContainer.why).to.equal('ok');
  });

  // A ufw reset deletes every rule; the owner then turns ufw back on. FluxOS's next
  // start opens the installed app's port again, before the app starts.
  it('opens the port again at the next start after a ufw reset', async function reset() {
    this.timeout(300000);
    const wiped = await inNode('ufw --force reset >/dev/null && ufw default deny incoming >/dev/null && ufw --force enable >/dev/null && ufw status');
    expect(wiped.exitCode, wiped.stderr).to.equal(0);
    expect(await portRules(appPort), 'the reset deleted the rule').to.deep.equal({ ipv4: [], ipv6: [] });

    const afterId = node.getLastEventId();
    await restartFluxos(node.container);
    await waitForBootSettled(node, 240000, { afterId });

    const rules = await portRules(appPort);
    expect(rules.ipv4, 'the IPv4 half').to.have.length(1);
    expect(rules.ipv6, 'the IPv6 half').to.have.length(1);
    const ipv6 = await answerFrom(NODE_V6, appPort);
    expect(ipv6.said, ipv6.why).to.equal('ok');
    const fromContainer = await answerFromAContainer(appPort);
    expect(fromContainer.said, fromContainer.why).to.equal('ok');
  });

  it('closes the port when the app is removed, and leaves the owner\'s own rules', async function removal() {
    this.timeout(180000);
    const owned = await inNode(`ufw allow 22 >/dev/null && ufw allow ${appPort}/tcp >/dev/null`);
    expect(owned.exitCode, owned.stderr).to.equal(0);
    const auth = await authenticate(node.url, fluxTeamKey());
    const res = await fetch(`${node.url}/apps/appremove/${appName}`, { headers: { zelidauth: auth.zelidauth } });
    await res.text();
    await waitForAppRemoved(node, appName, 120000);

    expect(await portRules(appPort)).to.deep.equal({ ipv4: [], ipv6: [] });
    const status = (await inNode('ufw status; true')).stdout.split('\n').map((line) => line.trim());
    expect(status.filter((line) => /^22\s+ALLOW/.test(line)), 'the owner\'s rule for 22').to.have.length(1);
    expect(status.filter((line) => new RegExp(`^${appPort}/tcp\\s+ALLOW`).test(line)), `the owner's rule for ${appPort}/tcp`).to.have.length(1);
  });
});
