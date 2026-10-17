const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const os = require('os');
const path = require('path');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const appSlice = require('../../ZelBack/src/services/appLifecycle/appSlice');

describe('appSlice tests', () => {
  let root;
  let runCommand;

  function slice(unit, populated) {
    const dir = path.join(root, 'flux.slice', unit);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cgroup.events'), `populated ${populated ? 1 : 0}\nfrozen 0\n`);
  }
  const stopped = () => runCommand.getCalls().map((call) => call.args[1].params[1]);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'appslice-'));
    appSlice.useCgroupRoot(root);
    runCommand = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null });
  });

  afterEach(() => {
    appSlice.useCgroupRoot('/sys/fs/cgroup');
    fs.rmSync(root, { recursive: true, force: true });
    sinon.restore();
  });

  describe('sliceName', () => {
    it('names the app\'s slice under flux.slice', () => {
      expect(appSlice.sliceName('palworld1790205120183')).to.equal('flux-palworld1790205120183.slice');
    });

    it('escapes each hyphen, so one app\'s slice never nests inside another\'s', () => {
      expect(appSlice.sliceName('my-app')).to.equal('flux-my\\x2dapp.slice');
      expect(appSlice.sliceName('my-app')).to.not.equal(`${appSlice.sliceName('my').slice(0, -'.slice'.length)}-app.slice`);
    });

    it('names no slice for a name no app can have', () => {
      ['', 'a_b', 'a.b', '../x', 'a b', null, undefined].forEach((name) => {
        expect(appSlice.sliceName(name), String(name)).to.equal(null);
      });
    });
  });

  describe('release', () => {
    it('stops the app\'s slice once nothing lives in it', async () => {
      slice('flux-my\\x2dapp.slice', false);

      await appSlice.release('my-app');

      sinon.assert.calledOnceWithExactly(runCommand, 'systemctl', { runAsRoot: true, params: ['stop', 'flux-my\\x2dapp.slice'] });
    });

    it('leaves a slice a process still lives in', async () => {
      slice('flux-busy.slice', true);

      await appSlice.release('busy');

      sinon.assert.notCalled(runCommand);
    });

    it('does nothing for an app with no slice', async () => {
      await appSlice.release('absent');

      sinon.assert.notCalled(runCommand);
    });
  });

  describe('stopEmptySlices', () => {
    it('stops every empty app slice, and leaves those in use and anything else', async () => {
      slice('flux-gone.slice', false);
      slice('flux-gone\\x2dtoo.slice', false);
      slice('flux-running.slice', true);
      slice('other.slice', false);

      const count = await appSlice.stopEmptySlices();

      expect(count).to.equal(2);
      expect(stopped()).to.have.members(['flux-gone.slice', 'flux-gone\\x2dtoo.slice']);
    });

    it('counts no slice systemd could not stop', async () => {
      slice('flux-gone.slice', false);
      runCommand.resolves({ error: new Error('unit busy') });

      expect(await appSlice.stopEmptySlices()).to.equal(0);
    });

    it('does nothing when there is no flux.slice', async () => {
      expect(await appSlice.stopEmptySlices()).to.equal(0);
      sinon.assert.notCalled(runCommand);
    });
  });
});
