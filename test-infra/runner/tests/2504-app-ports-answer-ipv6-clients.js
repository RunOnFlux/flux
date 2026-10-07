// An app's published port answers IPv6 clients on a node whose firewall is on.
//
// Docker forwards an IPv4 connection to a published port ahead of ufw's inbound
// rules, but answers an IPv6 one through docker-proxy on the node itself, behind
// them. FluxOS opens each app port to IPv6 when it installs the app and closes it
// when it removes the app.
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
import { execInContainer } from '../framework/container.js';
import { pushBusybox } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitForAppRemoved } from '../framework/wait.js';
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

describe('2504 app ports answer IPv6 clients on a firewalled node', function suite() {
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

  it('opens an installed app\'s port to IPv6 clients, by a rule that admits no IPv4 client', async () => {
    const rules = await portRules(appPort);
    expect(rules.ipv6, 'an IPv6 rule for the port').to.have.length(1);
    expect(rules.ipv4, 'an IPv4 rule for the port').to.deep.equal([]);

    const ipv6 = await answerFrom(NODE_V6, appPort);
    expect(ipv6.said, ipv6.why).to.equal('ok');
    const ipv4 = await answerFrom(node.ip, appPort);
    expect(ipv4.said, ipv4.why).to.equal('ok');
  });

  it('closes the port to IPv6 clients when the app is removed', async function removal() {
    this.timeout(180000);
    const auth = await authenticate(node.url, fluxTeamKey());
    const res = await fetch(`${node.url}/apps/appremove/${appName}`, { headers: { zelidauth: auth.zelidauth } });
    await res.text();
    await waitForAppRemoved(node, appName, 120000);

    expect(await portRules(appPort)).to.deep.equal({ ipv4: [], ipv6: [] });
  });
});
