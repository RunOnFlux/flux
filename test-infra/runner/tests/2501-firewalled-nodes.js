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

  // ufw's own record of a node's rules, one `ufw ...` command per rule.
  async function rulesAdded(index) {
    const { stdout } = await execInContainer(env.clients[index].container, 'ufw show added; true');
    return stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('ufw '));
  }
  const isOutbound = (rule) => /^ufw (allow|deny|reject|limit) out\b/.test(rule);

  // Holds ufw's lock as every ufw command takes it, from a process of its own
  // in the node, until releaseUfwLock.
  async function holdUfwLock(index) {
    await execInContainer(env.clients[index].container, [
      'setsid python3 -c \'import fcntl, time; f = open("/run/ufw.lock", "w"); fcntl.lockf(f, fcntl.LOCK_EX); open("/tmp/ufw-lock-held", "w").close(); time.sleep(3600)\' >/dev/null 2>&1 & echo $! > /tmp/ufw-lock.pid',
      'for i in $(seq 1 100); do [ -e /tmp/ufw-lock-held ] && break; sleep 0.1; done',
      'test -e /tmp/ufw-lock-held',
    ].join('; '));
  }
  const releaseUfwLock = (index) => execInContainer(env.clients[index].container, 'kill "$(cat /tmp/ufw-lock.pid)"; rm -f /tmp/ufw-lock-held /tmp/ufw-lock.pid');

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

  it('removes every outbound rule ufw writes and keeps every inbound and route rule as it was', async () => {
    const node = env.clients[LEGACY];
    await firewallAdjusted(LEGACY);
    // Outbound: plain (with its v6 twin), on an interface (with its twin), with a
    // comment, and v6 only - six tuples across the two rules files.
    const seeded = await execInContainer(node.container, [
      'ufw allow out 8080',
      'ufw allow out on eth0 to any port 443',
      "ufw deny out to 10.0.0.0/8 comment 'operator'",
      'ufw allow out to 2001:db8::1 port 53',
      'ufw allow in on eth0 to any port 4100',
      "ufw allow 4101 comment 'inbound'",
      'ufw route allow in on eth0 out on eth0 to any port 4102',
    ].join(' && '));
    expect(seeded.exitCode, seeded.stdout).to.equal(0);
    const before = await rulesAdded(LEGACY);
    expect(before.filter(isOutbound), 'the seeded outbound rules').to.have.lengthOf(4);
    const kept = before.filter((rule) => !isOutbound(rule));
    expect(kept.some((rule) => rule.startsWith('ufw route ')), 'a route rule to keep').to.equal(true);

    const afterId = node.getLastEventId();
    await restartFluxos(node.container);
    const { data } = await node.waitForEvent('firewall:adjusted', () => true, FLUXOS_RULES_TIMEOUT_MS, { afterId });

    expect(data.outboundRemoved).to.equal(6);
    const after = await rulesAdded(LEGACY);
    expect(after.filter(isOutbound), 'outbound rules left').to.deep.equal([]);
    expect(after.filter((rule) => !isOutbound(rule)), 'inbound and route rules').to.deep.equal(kept);
    // The live firewall, not only ufw's record of it.
    const { stdout: chains } = await execInContainer(node.container, 'iptables -S ufw-user-output; ip6tables -S ufw6-user-output; iptables -S ufw-user-input; iptables -S ufw-user-forward');
    expect(chains.split('\n').filter((line) => /-A ufw6?-user-output /.test(line)), 'live outbound rules').to.deep.equal([]);
    expect(chains).to.match(/-A ufw-user-input -i eth0 -p tcp -m tcp --dport 4100 -j ACCEPT/);
    expect(chains).to.match(/-A ufw-user-forward -i eth0 -o eth0 -p tcp -m tcp --dport 4102 -j ACCEPT/);
  });

  it('waits for ufw\'s lock, and a ufw command run meanwhile still lands', async () => {
    const node = env.clients[LEGACY];
    await execInContainer(node.container, 'ufw allow out 8081');
    await holdUfwLock(LEGACY);

    const afterId = node.getLastEventId();
    await restartFluxos(node.container);
    // An operator's ufw command, queued on the same lock.
    await execInContainer(node.container, 'setsid sh -c \'ufw allow 4242 > /tmp/ufw-4242.out 2>&1; echo exit=$? >> /tmp/ufw-4242.out\' >/dev/null 2>&1 &');
    await new Promise((resolve) => { setTimeout(resolve, 5000); });
    const { stdout: waiting } = await execInContainer(node.container, 'cat /tmp/ufw-4242.out 2>/dev/null; true');
    expect(waiting, 'the queued ufw command ran with the lock held').to.equal('');
    expect(node.getEventBuffer().filter((event) => event.id > afterId && event.event === 'firewall:adjusted'), 'FluxOS adjusted with the lock held').to.deep.equal([]);

    await releaseUfwLock(LEGACY);
    await node.waitForEvent('firewall:adjusted', () => true, FLUXOS_RULES_TIMEOUT_MS, { afterId });
    const { stdout: queued } = await execInContainer(node.container, 'for i in $(seq 1 100); do grep -q exit= /tmp/ufw-4242.out && break; sleep 0.2; done; cat /tmp/ufw-4242.out');
    expect(queued).to.match(/exit=0/);
    const rules = await rulesAdded(LEGACY);
    expect(rules, 'the queued rule').to.include('ufw allow 4242');
    expect(rules.filter(isOutbound), 'outbound rules left').to.deep.equal([]);
  });

  it('leaves the firewall as it is and boots on when ufw\'s lock stays held, and adjusts it at the next start', async () => {
    const node = env.clients[LEGACY];
    await execInContainer(node.container, 'ufw allow out 8082');
    await holdUfwLock(LEGACY);

    const lockedId = node.getLastEventId();
    await restartFluxos(node.container);
    await node.waitForEvent('firewall:locked', () => true, FLUXOS_RULES_TIMEOUT_MS, { afterId: lockedId });
    await node.waitForEvent('boot:settled', () => true, FLUXOS_RULES_TIMEOUT_MS, { afterId: lockedId });
    expect(node.getEventBuffer().filter((event) => event.id > lockedId && event.event === 'firewall:adjusted')).to.deep.equal([]);
    expect(await rulesAdded(LEGACY), 'the firewall as it was').to.include('ufw allow out 8082');

    await releaseUfwLock(LEGACY);
    const afterId = node.getLastEventId();
    await restartFluxos(node.container);
    await node.waitForEvent('firewall:adjusted', () => true, FLUXOS_RULES_TIMEOUT_MS, { afterId });
    expect((await rulesAdded(LEGACY)).filter(isOutbound), 'outbound rules left').to.deep.equal([]);
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
