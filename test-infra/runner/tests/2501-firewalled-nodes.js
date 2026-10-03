// The harness firewall switch: a firewalled node boots with ufw active as its
// install leaves it, and FluxOS then adds its own rules on top. A legacy node
// gets the legacy installer's baseline, an Arcane node the ISO's, and a node the
// switch does not name keeps ufw off.
//
// FluxOS's own rules are what make the switch worth having: each firewalled node
// must end up with a rule only FluxOS writes, so a firewall that came up but that
// FluxOS never saw as active fails here.
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, restartFluxos } from '../framework/container.js';
import { BUSYBOX_BIN } from '../framework/registry-helper.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const LEGACY = 0;
const ARCANE = 1;
const UNFIREWALLED = 2;

// apiport 16127 - 5
const FLUXADM_PORT = 16122;
const FLUXOS_RULES_TIMEOUT_MS = 180000;

describe('2501 firewalled nodes', function suite() {
  this.timeout(600000);

  let env;
  dumpLogsOnFailure(() => env);

  async function ufwStatus(index) {
    const { stdout } = await execInContainer(env.clients[index].container, 'ufw status verbose; true');
    return stdout;
  }

  // Published once FluxOS has applied its rules to an active firewall.
  const firewallAdjusted = (index) => env.clients[index].waitForEvent('firewall:adjusted', () => true, FLUXOS_RULES_TIMEOUT_MS);

  before(async function hook() {
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      legacyNodes: [LEGACY],
      firewall: [LEGACY, ARCANE],
      tickerAutostart: false,
    });
  });

  after(async () => {
    await env?.teardown();
  });

  it('boots a legacy node with the legacy installer\'s firewall', async () => {
    const status = await ufwStatus(LEGACY);
    expect(status).to.match(/^Status: active$/m);
    expect(status).to.match(/^Default: deny \(incoming\), allow \(outgoing\)/m);
    expect(status).to.match(/^22\/tcp\s+ALLOW IN\s+Anywhere\s*$/m);
    expect(status).to.match(/^16100:16199\/tcp\s+ALLOW IN\s+Anywhere\s*$/m);
    expect(status, 'without openssh-server there is no OpenSSH profile to limit').to.not.match(/OpenSSH/);
  });

  it('boots an Arcane node with the ISO\'s firewall', async () => {
    const status = await ufwStatus(ARCANE);
    expect(status).to.match(/^Status: active$/m);
    expect(status).to.match(/^Default: deny \(incoming\), allow \(outgoing\), deny \(routed\)$/m);
    expect(status).to.match(/^22\/tcp \(OpenSSH\)\s+LIMIT IN\s+Anywhere\s*$/m);
    expect(status, 'the legacy installer\'s port range is not the ISO\'s').to.not.match(/16100:16199/);
  });

  it('lets FluxOS add its own rules on both', async () => {
    // eslint-disable-next-line no-restricted-syntax
    for (const index of [LEGACY, ARCANE]) {
      // eslint-disable-next-line no-await-in-loop
      await firewallAdjusted(index);
      // Port 80 inbound is opened by FluxOS's adjustFirewall and by neither baseline.
      // eslint-disable-next-line no-await-in-loop
      expect(await ufwStatus(index), `FluxOS's own rules on node ${index}`).to.match(/^80\s+ALLOW IN\s+Anywhere\s*$/m);
    }
  });

  it('leaves no outbound rule once FluxOS has run, the default allow governing outbound', async () => {
    const { data } = await firewallAdjusted(LEGACY);
    expect(data.outboundRemoved, 'the legacy installer\'s outbound rules removed').to.be.above(0);
    await firewallAdjusted(ARCANE);
    // eslint-disable-next-line no-restricted-syntax
    for (const index of [LEGACY, ARCANE]) {
      // eslint-disable-next-line no-await-in-loop
      const status = await ufwStatus(index);
      expect(status).to.match(/^Default: [^\n]*allow \(outgoing\)/m);
      expect(status.split('\n').filter((line) => /\bOUT\b/.test(line)), `outbound rules on node ${index}`).to.deep.equal([]);
    }
  });

  it('opens the maintenance port by its FluxadmSSH profile on the Arcane node only', async () => {
    await firewallAdjusted(ARCANE);
    await firewallAdjusted(LEGACY);
    expect(await ufwStatus(ARCANE)).to.match(new RegExp(`^${FLUXADM_PORT}/tcp \\(FluxadmSSH\\)\\s+ALLOW IN`, 'm'));
    expect(await ufwStatus(LEGACY)).to.not.match(/FluxadmSSH/);
  });

  it('keeps ufw off on a node the switch does not name', async () => {
    expect(await ufwStatus(UNFIREWALLED)).to.match(/^Status: inactive$/m);
  });

  // The state a node boots into when /etc/default/ufw was left empty: ufw-init
  // refuses to start, so no ufw chain is loaded and INPUT accepts everything.
  it('restores an emptied ufw defaults file and its firewall when FluxOS next starts', async () => {
    const node = env.clients[LEGACY];
    const inputChain = async () => (await execInContainer(node.container, 'iptables -S INPUT')).stdout;
    await execInContainer(node.container, '/lib/ufw/ufw-init flush-all >/dev/null 2>&1; : > /etc/default/ufw; iptables -P INPUT ACCEPT; ip6tables -P INPUT ACCEPT');
    const { stdout: broken } = await execInContainer(node.container, 'ufw status 2>&1; true');
    expect(broken, 'ufw must be broken before FluxOS starts').to.match(/Missing policy/);
    expect(await inputChain()).to.not.match(/ufw-/);

    // Every change made in /etc/default while FluxOS repairs the file: one line
    // per event, its letters, the directory, and the file it touched.
    await node.container.copyFilesToContainer([{ source: BUSYBOX_BIN, target: '/usr/local/bin/busybox', mode: 0o755 }]);
    await execInContainer(node.container, '/usr/local/bin/busybox inotifyd - /etc/default:cwnydm > /tmp/etc-default-events 2>&1 & echo $! > /tmp/etc-default-watch.pid');

    const afterId = node.getLastEventId();
    await restartFluxos(node.container);
    const { data } = await node.waitForEvent('firewall:defaultsWritten', () => true, FLUXOS_RULES_TIMEOUT_MS, { afterId });

    const { stdout: events } = await execInContainer(node.container, 'kill "$(cat /tmp/etc-default-watch.pid)"; cat /tmp/etc-default-events');
    const touching = (file) => events.split('\n').map((line) => line.split('\t')).filter((fields) => fields[2] === file).map((fields) => fields[0]);
    expect(touching('ufw'), `/etc/default/ufw must change only by a rename into place:\n${events}`).to.deep.equal(['y']);
    expect(touching('ufw.flux-new'), `the repair was not seen staging its copy:\n${events}`).to.include('n');

    expect(data.restored).to.equal(true);
    const { stdout: md5 } = await execInContainer(node.container, 'md5sum /etc/default/ufw');
    expect(md5.split(' ')[0], 'the file the ufw package ships').to.equal('a921dd9d167380b04de4bc911915ea44');
    expect(await ufwStatus(LEGACY)).to.match(/^Status: active$/m);
    const input = await inputChain();
    expect(input).to.match(/^-P INPUT DROP$/m);
    expect(input).to.match(/^-A INPUT -j ufw-before-input$/m);
  });
});
