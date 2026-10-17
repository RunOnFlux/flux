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

  const id = (n) => String(n).repeat(64).slice(0, 64);

  function cgroup(rel, pids) {
    const dir = path.join(cgroupRoot, rel);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cgroup.procs'), pids.map((pid) => `${pid}\n`).join(''));
    fs.writeFileSync(path.join(dir, 'cgroup.kill'), '');
    return dir;
  }
  function container(n, name, pids) {
    fs.mkdirSync(path.join(dockerRoot, 'containers', id(n)), { recursive: true });
    fs.writeFileSync(path.join(dockerRoot, 'containers', id(n), 'config.v2.json'), JSON.stringify({ Name: `/${name}`, State: { Pid: Number(pids[0] ?? 0) } }));
    return cgroup(path.join('system.slice', `docker-${id(n)}.scope`), pids);
  }
  function processWith(pid, { sigPnd = '0000000000000000', shdPnd = '0000000000000000' } = {}) {
    fs.mkdirSync(path.join(procRoot, pid), { recursive: true });
    fs.writeFileSync(path.join(procRoot, pid, 'status'), `Name:\tapp\nSigPnd:\t${sigPnd}\nShdPnd:\t${shdPnd}\n`);
  }

  // what sudo would do: read and list as root, and write to cgroup.kill
  function asRoot(cmd, { params }) {
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
    sinon.stub(serviceHelper, 'runCommand').callsFake(asRoot);
  });

  afterEach(() => {
    appKill.reset();
    fs.rmSync(root, { recursive: true, force: true });
    sinon.restore();
  });

  describe('kill', () => {
    it('kills the app\'s slice and the scopes of its containers made before slices, and no other app\'s', async () => {
      const slice = cgroup(path.join('flux.slice', 'flux-my\\x2dapp.slice'), ['10']);
      const web = container(1, 'fluxweb_my-app', ['11']);
      const single = container(2, 'fluxmy-app', ['12']);
      container(3, 'fluxweb_my-app2', ['13']);
      container(4, 'fluxweb_other', ['14']);
      cgroup(path.join('flux.slice', 'flux-my.slice'), ['15']);

      const sent = await appKill.kill('my-app');

      expect(sent).to.have.members([slice, web, single]);
      expect(killed).to.have.members([slice, web, single]);
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
      cgroup(path.join('flux.slice', 'flux-app.slice'), ['21', '22', '23', '24']);
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

    it('names nothing for an app with no cgroup left', async () => {
      expect(await appKill.stillRunnable('other')).to.deep.equal([]);
    });
  });

  describe('appsOnDisk', () => {
    it('names every app with a slice or a container record, and no container that is not an app\'s', async () => {
      cgroup(path.join('flux.slice', 'flux-sliced\\x2dapp.slice'), []);
      container(1, 'fluxweb_composed', ['11']);
      container(2, 'fluxsingle', ['12']);
      container(3, 'watchtower', ['13']);

      expect(await appKill.appsOnDisk()).to.have.members(['sliced-app', 'composed', 'single']);
    });
  });
});
