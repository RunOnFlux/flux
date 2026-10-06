const { expect } = require('chai');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const helper = path.join(__dirname, '../../helpers/ufw/apply-node-firewall.py');

// A rules file as ufw writes it: header, then each rule as its tuple and its
// iptables lines followed by a blank line, then the END RULES marker and the
// rest of the file.
const rulesFile = (blocks, chain = 'ufw') => [
  '*filter',
  `:${chain}-user-input - [0:0]`,
  `:${chain}-user-output - [0:0]`,
  '### RULES ###',
  '',
  ...blocks.flatMap((block) => [...block, '']),
  '### END RULES ###',
  '',
  '### LOGGING ###',
  `-A ${chain}-user-logging-input -j RETURN`,
  'COMMIT',
  '',
].join('\n');

// One block per shape ufw writes, named by what ufw reads it as.
const OUT = {
  plain: ['### tuple ### allow tcp 53 0.0.0.0/0 any 0.0.0.0/0 out', '-A ufw-user-output -p tcp --dport 53 -j ACCEPT'],
  twoChains: ['### tuple ### allow any 5060 0.0.0.0/0 any 0.0.0.0/0 out', '-A ufw-user-output -p tcp --dport 5060 -j ACCEPT', '-A ufw-user-output -p udp --dport 5060 -j ACCEPT'],
  iface: ['### tuple ### allow any 443 0.0.0.0/0 any 0.0.0.0/0 out_eth0', '-A ufw-user-output -o eth0 -p tcp --dport 443 -j ACCEPT'],
  comment: ['### tuple ### deny any any 10.0.0.0/8 any 0.0.0.0/0 out comment=6e657473636e', '-A ufw-user-output -d 10.0.0.0/8 -j DROP'],
  app: ['### tuple ### allow tcp 22 0.0.0.0/0 any 0.0.0.0/0 OpenSSH - out', '-A ufw-user-output -p tcp --dport 22 -j ACCEPT'],
};
const KEEP = {
  inbound: ['### tuple ### allow any 16127 0.0.0.0/0 any 0.0.0.0/0 in', '-A ufw-user-input -p tcp --dport 16127 -j ACCEPT'],
  inboundIface: ['### tuple ### allow udp any 0.0.0.0/0 any 192.168.1.1 in_eth0', '-A ufw-user-input -i eth0 -p udp -s 192.168.1.1 -j ACCEPT'],
  // The format before ufw recorded a direction: 6 fields, read as inbound.
  oldFormat: ['### tuple ### allow tcp 25 0.0.0.0/0 any 0.0.0.0/0', '-A ufw-user-input -p tcp --dport 25 -j ACCEPT'],
  app: ['### tuple ### limit tcp 22 0.0.0.0/0 any 0.0.0.0/0 OpenSSH - in', '-A ufw-user-input -p tcp --dport 22 -j ACCEPT'],
  routeOut: ['### tuple ### route:allow any any 0.0.0.0/0 any 0.0.0.0/0 out_eth1', '-A ufw-user-forward -o eth1 -j ACCEPT'],
  routeBoth: ['### tuple ### route:allow any any 0.0.0.0/0 any 0.0.0.0/0 in_eth0!out_eth1', '-A ufw-user-forward -i eth0 -o eth1 -j ACCEPT'],
  inboundComment: ['### tuple ### allow tcp 80 0.0.0.0/0 any 0.0.0.0/0 in comment=6f7574', '-A ufw-user-input -p tcp --dport 80 -j ACCEPT'],
};

describe('ufw apply-node-firewall helper', () => {
  let dir;
  let lockPath;
  let holders;

  const write = (name, text, mode = 0o640) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    fs.chmodSync(file, mode);
    return file;
  };

  const run = (files, wait = 2) => spawnSync('python3', [helper, '--lock', lockPath, '--wait', String(wait), ...files], { encoding: 'utf8' });

  // Holds the lock the way every ufw command does, from another process, until killed.
  const holdLock = () => new Promise((resolve, reject) => {
    const holder = spawn('python3', ['-c', [
      'import fcntl, sys, time',
      `f = open(${JSON.stringify(lockPath)}, "w")`,
      'fcntl.lockf(f, fcntl.LOCK_EX)',
      'print("held", flush=True)',
      'time.sleep(600)',
    ].join('\n')]);
    holders.push(holder);
    holder.stdout.once('data', () => resolve(holder));
    holder.once('error', reject);
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-ufw-rules-'));
    lockPath = path.join(dir, 'ufw.lock');
    holders = [];
  });

  afterEach(() => {
    holders.forEach((holder) => holder.kill('SIGKILL'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ufw's library as the helper uses it, replaced by a package earlier on the
  // path: it records each rule it is asked to apply, refuses the action
  // `refuse`, and prints on stdout as ufw's own library does.
  const fakeUfw = (behaviour = '') => {
    const root = path.join(dir, 'fake');
    fs.mkdirSync(path.join(root, 'ufw'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ufw', '__init__.py'), '');
    fs.writeFileSync(path.join(root, 'ufw', 'common.py'), [
      'class UFWError(Exception):',
      '    def __init__(self, value):',
      '        Exception.__init__(self, value)',
      '        self.value = value',
    ].join('\n'));
    fs.writeFileSync(path.join(root, 'ufw', 'frontend.py'), [
      'import json, os',
      'from ufw.common import UFWError',
      'class Parsed:',
      '    def __init__(self, argv):',
      '        self.action = argv[1]',
      '        self.data = {"rule": " ".join(argv[2:]), "iptype": "both"}',
      'def parse_command(argv):',
      '    return Parsed(argv)',
      'class UFWFrontend:',
      '    def __init__(self, dryrun):',
      `        if ${JSON.stringify(behaviour)} == "broken-constructor": raise RuntimeError("no backend")`,
      '        self.dryrun = dryrun',
      '    def do_action(self, action, rule, ip_version, force):',
      `        if ${JSON.stringify(behaviour)} == "wrong-signature": raise TypeError("do_action() takes 3 arguments")`,
      '        print("Rule added")',
      '        if action == "refuse": raise UFWError("ERROR: Could not find a profile matching refuse")',
      `        with open(${JSON.stringify(path.join(dir, 'applied.jsonl'))}, "a") as f:`,
      '            f.write(json.dumps([action, rule, ip_version, force, self.dryrun]) + "\\n")',
    ].join('\n'));
    return root;
  };
  const applied = () => {
    const file = path.join(dir, 'applied.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
  };
  const runWithRules = (files, rules, behaviour) => spawnSync('python3', [helper, '--lock', lockPath, '--wait', '2', '--rules', JSON.stringify(rules), ...files], {
    encoding: 'utf8', env: { ...process.env, PYTHONPATH: fakeUfw(behaviour) },
  });

  it('applies the rules through ufw\'s library in order, after removing the outbound rules, with stdout only its result', () => {
    const file = write('user.rules', rulesFile([OUT.plain, KEEP.inbound]));

    const result = runWithRules([file], [['allow', '16127'], ['insert', '1', 'allow', 'from', '192.168.1.1']]);

    expect(result.status, result.stderr).to.equal(0);
    expect(JSON.parse(result.stdout)).to.deep.equal({ removed: 1, applied: true, failed: [], reason: null });
    expect(applied()).to.deep.equal([
      ['allow', '16127', 'both', true, false],
      ['insert', '1 allow from 192.168.1.1', 'both', true, false],
    ]);
    expect(fs.readFileSync(file, 'utf8')).to.equal(rulesFile([KEEP.inbound]));
  });

  it('reports a rule ufw refuses and still applies the rest', () => {
    const file = write('user.rules', rulesFile([KEEP.inbound]));

    const result = runWithRules([file], [['allow', '16127'], ['refuse'], ['allow', '16128']]);

    expect(JSON.parse(result.stdout)).to.deep.equal({
      removed: 0, applied: true, failed: [{ rule: 'refuse', error: 'ERROR: Could not find a profile matching refuse' }], reason: null,
    });
    expect(applied().map(([, rule]) => rule)).to.deep.equal(['16127', '16128']);
  });

  ['broken-constructor', 'wrong-signature'].forEach((behaviour) => {
    it(`says the rules were not applied when ufw's library cannot be used (${behaviour}), with the outbound rules still removed`, () => {
      const file = write('user.rules', rulesFile([OUT.plain, KEEP.inbound]));

      const result = runWithRules([file], [['allow', '16127']], behaviour);

      expect(result.status, result.stderr).to.equal(0);
      const answer = JSON.parse(result.stdout);
      expect(answer).to.include({ removed: 1, applied: false });
      expect(answer.reason).to.match(/^ufw library not usable: /);
      expect(fs.readFileSync(file, 'utf8')).to.equal(rulesFile([KEEP.inbound]));
    });
  });

  it('applies nothing and changes nothing when the lock stays held for the whole wait', async () => {
    const text = rulesFile([OUT.plain, KEEP.inbound]);
    const file = write('user.rules', text);
    await holdLock();

    const result = spawnSync('python3', [helper, '--lock', lockPath, '--wait', '0.5', '--rules', JSON.stringify([['allow', '16127']]), file], {
      encoding: 'utf8', env: { ...process.env, PYTHONPATH: fakeUfw() },
    });

    expect(result.status).to.equal(75);
    expect(applied()).to.deep.equal([]);
    expect(fs.readFileSync(file, 'utf8')).to.equal(text);
  });

  it('removes every outbound rule ufw writes, and keeps every inbound and route rule as it was', () => {
    const file = write('user.rules', rulesFile([
      KEEP.inbound, OUT.plain, KEEP.oldFormat, OUT.twoChains, KEEP.inboundIface, OUT.iface,
      KEEP.app, OUT.comment, KEEP.routeOut, OUT.app, KEEP.routeBoth, KEEP.inboundComment,
    ]));

    const result = run([file]);

    expect(result.status, result.stderr).to.equal(0);
    expect(JSON.parse(result.stdout)).to.deep.equal({ removed: 5, applied: true, failed: [], reason: null });
    expect(fs.readFileSync(file, 'utf8')).to.equal(rulesFile([
      KEEP.inbound, KEEP.oldFormat, KEEP.inboundIface, KEEP.app, KEEP.routeOut, KEEP.routeBoth, KEEP.inboundComment,
    ]));
  });

  it('removes the outbound rules from the IPv6 file too, counting both', () => {
    const v4 = write('user.rules', rulesFile([OUT.plain, KEEP.inbound]));
    const v6 = write('user6.rules', rulesFile([
      ['### tuple ### allow tcp 53 ::/0 any ::/0 out', '-A ufw6-user-output -p tcp --dport 53 -j ACCEPT'],
      ['### tuple ### allow any 16127 ::/0 any ::/0 in', '-A ufw6-user-input -p tcp --dport 16127 -j ACCEPT'],
    ], 'ufw6'));

    const result = run([v4, v6]);

    expect(JSON.parse(result.stdout)).to.deep.equal({ removed: 2, applied: true, failed: [], reason: null });
    expect(fs.readFileSync(v6, 'utf8')).to.equal(rulesFile([
      ['### tuple ### allow any 16127 ::/0 any ::/0 in', '-A ufw6-user-input -p tcp --dport 16127 -j ACCEPT'],
    ], 'ufw6'));
  });

  it('leaves a file with no outbound rule untouched, and skips a file that does not exist', () => {
    const file = write('user.rules', rulesFile([KEEP.inbound, KEEP.routeOut]));
    const before = fs.statSync(file);

    const result = run([file, path.join(dir, 'user6.rules')]);

    expect(result.status, result.stderr).to.equal(0);
    expect(JSON.parse(result.stdout)).to.deep.equal({ removed: 0, applied: true, failed: [], reason: null });
    expect(fs.statSync(file).ino).to.equal(before.ino);
  });

  it('replaces the file whole, with its mode kept and no staging file left', () => {
    const file = write('user.rules', rulesFile([OUT.plain, KEEP.inbound]), 0o640);
    const before = fs.statSync(file);

    run([file]);

    const after = fs.statSync(file);
    expect(after.ino).to.not.equal(before.ino);
    expect(after.mode & 0o7777).to.equal(0o640);
    expect(fs.readdirSync(dir).filter((name) => name.startsWith('.flux-'))).to.deep.equal([]);
  });

  it('changes nothing and exits 75 when the lock stays held for the whole wait', async () => {
    const text = rulesFile([OUT.plain, KEEP.inbound]);
    const file = write('user.rules', text);
    await holdLock();

    const result = run([file], 0.5);

    expect(result.status).to.equal(75);
    expect(result.stderr).to.match(/not free within 0\.5s/);
    expect(fs.readFileSync(file, 'utf8')).to.equal(text);
  });

  it('waits for a lock that is released within the wait, then removes the rules', async () => {
    const file = write('user.rules', rulesFile([OUT.plain, KEEP.inbound]));
    const holder = await holdLock();
    setTimeout(() => holder.kill('SIGKILL'), 300);

    const removed = await new Promise((resolve) => {
      const child = spawn('python3', [helper, '--lock', lockPath, '--wait', '5', file]);
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('close', (code) => resolve({ code, out }));
    });

    expect(removed.code).to.equal(0);
    expect(JSON.parse(removed.out)).to.deep.equal({ removed: 1, applied: true, failed: [], reason: null });
    expect(fs.readFileSync(file, 'utf8')).to.equal(rulesFile([KEEP.inbound]));
  });
});
