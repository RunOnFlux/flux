const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('node:events');
const proxyquire = require('proxyquire').noCallThru();

describe('volumeUnmountWatch tests', () => {
  const ROOT = '/apps/fluxdb_App';
  let stubs;
  let unmountWatch;
  let watchers;
  let devices;

  beforeEach(() => {
    watchers = [];
    // the volume root is a filesystem of its own unless a test says otherwise
    devices = { [ROOT]: 2, '/apps': 1 };
    stubs = {
      fs: {
        watch: sinon.stub().callsFake((dir, listener) => {
          const watcher = new EventEmitter();
          watcher.dir = dir;
          watcher.listener = listener;
          watcher.close = sinon.stub();
          watchers.push(watcher);
          return watcher;
        }),
        promises: {
          stat: sinon.stub().callsFake(async (dir) => {
            if (!(dir in devices)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            return { dev: devices[dir] };
          }),
        },
      },
      log: { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
    };
    unmountWatch = proxyquire('../../ZelBack/src/services/utils/volumeUnmountWatch', {
      'node:fs': stubs.fs,
      '../../lib/log': stubs.log,
    });
  });

  afterEach(() => sinon.restore());

  it('watches a mounted volume at its root', async () => {
    expect(await unmountWatch.watchVolume('fluxdb_App', ROOT)).to.equal(true);
    sinon.assert.calledOnce(stubs.fs.watch);
    expect(watchers[0].dir).to.equal(ROOT);
    expect(unmountWatch.watchedVolumes()).to.deep.equal(['fluxdb_App']);
  });

  it('tells of the unmount, an event named for the root itself, and stops watching', async () => {
    const told = sinon.stub();
    unmountWatch.setOnUnmount(told);
    await unmountWatch.watchVolume('fluxdb_App', ROOT);
    watchers[0].listener('rename', 'fluxdb_App');
    sinon.assert.calledOnceWithExactly(told, 'fluxdb_App');
    sinon.assert.calledOnce(watchers[0].close);
    expect(unmountWatch.watchedVolumes()).to.deep.equal([]);
  });

  it('takes nothing from entries changing in the root', async () => {
    const told = sinon.stub();
    unmountWatch.setOnUnmount(told);
    await unmountWatch.watchVolume('fluxdb_App', ROOT);
    ['backup', '.flux-op', 'lost+found', 'appdata', null].forEach((name) => watchers[0].listener('rename', name));
    watchers[0].listener('change', '.stignore');
    sinon.assert.notCalled(told);
    expect(unmountWatch.watchedVolumes()).to.deep.equal(['fluxdb_App']);
  });

  it('does not watch a directory that is not a mount root', async () => {
    devices[ROOT] = 1;
    expect(await unmountWatch.watchVolume('fluxdb_App', ROOT)).to.equal(false);
    sinon.assert.notCalled(stubs.fs.watch);
  });

  it('drops a watch set on a volume unmounted while it was being set', async () => {
    let calls = 0;
    stubs.fs.promises.stat.callsFake(async (dir) => {
      if (dir === ROOT) { calls += 1; return { dev: calls === 1 ? 2 : 1 }; }
      return { dev: 1 };
    });
    expect(await unmountWatch.watchVolume('fluxdb_App', ROOT)).to.equal(false);
    sinon.assert.calledOnce(watchers[0].close);
    expect(unmountWatch.watchedVolumes()).to.deep.equal([]);
  });

  it('watches a volume once however often it is found mounted', async () => {
    await unmountWatch.watchVolume('fluxdb_App', ROOT);
    await unmountWatch.watchVolume('fluxdb_App', ROOT);
    sinon.assert.calledOnce(stubs.fs.watch);
  });

  it('watches it again once it is mounted after an unmount', async () => {
    unmountWatch.setOnUnmount(sinon.stub());
    await unmountWatch.watchVolume('fluxdb_App', ROOT);
    watchers[0].listener('rename', 'fluxdb_App');
    expect(await unmountWatch.watchVolume('fluxdb_App', ROOT)).to.equal(true);
    sinon.assert.calledTwice(stubs.fs.watch);
  });

  it('stops watching a volume whose watch fails, so the next mount check sets it again', async () => {
    await unmountWatch.watchVolume('fluxdb_App', ROOT);
    watchers[0].emit('error', new Error('EMFILE'));
    expect(unmountWatch.watchedVolumes()).to.deep.equal([]);
    expect(await unmountWatch.watchVolume('fluxdb_App', ROOT)).to.equal(true);
  });

  it('answers false, and throws nothing, when the watch cannot be set', async () => {
    stubs.fs.watch.throws(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));
    expect(await unmountWatch.watchVolume('fluxdb_App', ROOT)).to.equal(false);
    expect(unmountWatch.watchedVolumes()).to.deep.equal([]);
  });
});
