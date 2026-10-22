const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const os = require('os');
const path = require('path');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const appKill = require('../../ZelBack/src/services/appLifecycle/appKill');

describe('appKill tests', () => {
  let root;
  let cgroupRoot;
  let procRoot;
  let dockerRoot;
  let killed;
  // unit -> its cgroup, as systemd reports it
  let units;

  const id = (n) => String(n).repeat(64).slice(0, 64);
  // systemd runs in a container here, so its tree starts below the filesystem's root
  const SYSTEMD_ROOT = '/init';

  function cgroup(rel, pids) {
    const dir = path.join(cgroupRoot, SYSTEMD_ROOT, rel);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cgroup.procs'), pids.map((pid) => `${pid}\n`).join(''));
    fs.writeFileSync(path.join(dir, 'cgroup.kill'), '');
    units.set(path.basename(rel), path.join(SYSTEMD_ROOT, rel));
    if (rel.startsWith('flux.slice/')) units.set('flux.slice', path.join(SYSTEMD_ROOT, 'flux.slice'));
    return dir;
  }
  // `app`: the runonflux.app label FluxOS sets; left out, a container made before it
  function record(n, name, pid = 0, { app } = {}) {
    fs.mkdirSync(path.join(dockerRoot, 'containers', id(n)), { recursive: true });
    const labels = app ? { 'runonflux.app': app } : {};
    fs.writeFileSync(path.join(dockerRoot, 'containers', id(n), 'config.v2.json'), JSON.stringify({ Name: `/${name}`, State: { Pid: Number(pid) }, Config: { Labels: labels } }));
  }
  function container(n, name, pids) {
    record(n, name, pids[0]);
    return cgroup(path.join('system.slice', `docker-${id(n)}.scope`), pids);
  }
  // An app's slice, as the kernel lays it out: no process of its own, and each
  // container's processes in the container's scope below it.
  function slice(unit, scopes) {
    const dir = cgroup(path.join('flux.slice', unit), []);
    Object.entries(scopes).forEach(([scope, pids]) => cgroup(path.join('flux.slice', unit, scope), pids));
    return dir;
  }
  function processWith(pid, { sigPnd = '0000000000000000', shdPnd = '0000000000000000' } = {}) {
    fs.mkdirSync(path.join(procRoot, pid), { recursive: true });
    fs.writeFileSync(path.join(procRoot, pid, 'status'), `Name:\tapp\nSigPnd:\t${sigPnd}\nShdPnd:\t${shdPnd}\n`);
  }

  // what sudo would do: read and list as root, and write to cgroup.kill; and
  // what systemd answers about a unit's cgroup
  function asRoot(cmd, { params }) {
    if (cmd === 'systemctl') return Promise.resolve({ stdout: `${units.get(params[4]) ?? ''}\n`, error: null });
    if (cmd === 'ls') return Promise.resolve({ stdout: fs.readdirSync(params[1]).join('\n'), error: null });
    if (cmd === 'cat') {
      try {
        return Promise.resolve({ stdout: fs.readFileSync(params[0], 'utf8'), error: null });
      } catch (error) {
        return Promise.resolve({ stdout: '', error });
      }
    }
    if (cmd === 'sh') {
      killed.push(path.dirname(params[3]));
      return Promise.resolve({ stdout: '', error: null });
    }
    return Promise.resolve({ stdout: '', error: new Error(`unexpected ${cmd}`) });
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'appkill-'));
    cgroupRoot = path.join(root, 'cgroup');
    procRoot = path.join(root, 'proc');
    dockerRoot = path.join(root, 'docker');
    fs.mkdirSync(path.join(dockerRoot, 'containers'), { recursive: true });
    appKill.usePaths({ cgroupRoot, procRoot, dockerRoot });
    killed = [];
    units = new Map();
    sinon.stub(serviceHelper, 'runCommand').callsFake(asRoot);
  });

  afterEach(() => {
    appKill.reset();
    fs.rmSync(root, { recursive: true, force: true });
    sinon.restore();
  });

  describe('kill', () => {
    it('kills the app\'s slice and the scopes of its containers made before slices, and no other app\'s', async () => {
      const appSliceDir = slice('flux-my\\x2dapp.slice', { [`docker-${id(9)}.scope`]: ['10'] });
      record(9, 'fluxdb_my-app', '10');
      const web = container(1, 'fluxweb_my-app', ['11']);
      const single = container(2, 'fluxmy-app', ['12']);
      container(3, 'fluxweb_my-app2', ['13']);
      container(4, 'fluxweb_other', ['14']);
      slice('flux-my.slice', { [`docker-${id(8)}.scope`]: ['15'] });

      const sent = await appKill.kill('my-app');

      expect(sent).to.have.members([appSliceDir, web, single]);
      expect(killed).to.have.members([appSliceDir, web, single]);
    });

    it('sends nothing for an app with no cgroup left', async () => {
      fs.mkdirSync(path.join(dockerRoot, 'containers', id(5)), { recursive: true });
      fs.writeFileSync(path.join(dockerRoot, 'containers', id(5), 'config.v2.json'), JSON.stringify({ Name: '/fluxgone' }));

      expect(await appKill.kill('gone')).to.deep.equal([]);
      expect(killed).to.deep.equal([]);
    });

    it('passes over a container record it cannot read', async () => {
      const web = container(1, 'fluxweb_app', ['11']);
      fs.mkdirSync(path.join(dockerRoot, 'containers', id(6)), { recursive: true });
      fs.writeFileSync(path.join(dockerRoot, 'containers', id(6), 'config.v2.json'), '{ broken');

      expect(await appKill.kill('app')).to.deep.equal([web]);
    });
  });

  describe('stillRunnable', () => {
    beforeEach(() => {
      slice('flux-app.slice', { [`docker-${id(1)}.scope`]: ['21', '22'], [`docker-${id(2)}.scope`]: ['23', '24'] });
    });

    it('names each process that is neither gone nor has the kill pending', async () => {
      processWith('21');
      processWith('22', { shdPnd: '0000000000000100' });
      processWith('23', { sigPnd: '0000000000004100' });
      // 24 is gone

      expect(await appKill.stillRunnable('app')).to.deep.equal(['21']);
    });

    it('does not take another pending signal for the kill', async () => {
      ['21', '22', '23', '24'].forEach((pid) => processWith(pid, { shdPnd: '0000000000004000' }));

      expect(await appKill.stillRunnable('app')).to.deep.equal(['21', '22', '23', '24']);
    });

    it('reads the processes in every scope under the slice, the slice itself holding none', async () => {
      ['21', '22', '23', '24'].forEach((pid) => processWith(pid));

      expect(await appKill.stillRunnable('app')).to.have.members(['21', '22', '23', '24']);
    });

    it('names nothing for an app with no cgroup left', async () => {
      expect(await appKill.stillRunnable('other')).to.deep.equal([]);
    });
  });

  describe('appsOnDisk', () => {
    it('names every app with a slice or a container record, and no container that is not an app\'s', async () => {
      slice('flux-sliced\\x2dapp.slice', {});
      container(1, 'fluxweb_composed', ['11']);
      container(2, 'fluxsingle', ['12']);
      container(3, 'watchtower', ['13']);

      expect(await appKill.appsOnDisk()).to.have.members(['sliced-app', 'composed', 'single']);
    });

    it('names a labelled container\'s app by its label, and a zel component\'s by its name', async () => {
      record(1, 'fluxgame', 0, { app: 'fluxgame' });
      record(2, 'zelcash_legacy');

      expect(await appKill.appsOnDisk()).to.have.members(['fluxgame', 'legacy']);
    });
  });

  describe('containersOf', () => {
    it('names every container of the app from docker\'s records, and no other app\'s', async () => {
      record(1, 'fluxweb_composed');
      record(2, 'fluxdb_composed');
      record(3, 'fluxweb_composedtoo');
      record(4, 'fluxcomposed');

      expect(await appKill.containersOf('composed')).to.have.members(['fluxweb_composed', 'fluxdb_composed', 'fluxcomposed']);
    });

    it('takes a container\'s label over its name', async () => {
      record(1, 'fluxweb_composed', 0, { app: 'other' });
      record(2, 'renamed', 0, { app: 'composed' });

      expect(await appKill.containersOf('composed')).to.have.members(['renamed']);
    });

    it('finds a label-less component whose name starts with zel', async () => {
      record(1, 'zelcash_legacy');

      expect(await appKill.containersOf('legacy')).to.have.members(['zelcash_legacy']);
    });

    it('finds the label-less container of an app whose own name starts with flux', async () => {
      record(1, 'fluxgame');

      expect(await appKill.containersOf('fluxgame')).to.have.members(['fluxgame']);
    });

    it('does not take a container FluxOS did not name for an app whose name it ends with', async () => {
      record(1, 'my_composed');

      expect(await appKill.containersOf('composed')).to.deep.equal([]);
    });
  });
});
