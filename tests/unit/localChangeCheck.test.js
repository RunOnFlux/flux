const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const fluxEventBus = require('../../ZelBack/src/services/utils/fluxEventBus');

const syncthingServiceMock = {
  getDeviceId: sinon.stub(),
  getDbLocalChanged: sinon.stub(),
  getDbFile: sinon.stub(),
};
const localChangeCheck = proxyquire('../../ZelBack/src/services/appMonitoring/localChangeCheck', {
  '../syncthingService': syncthingServiceMock,
});

async function settled() {
  for (let i = 0; i < 50; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setImmediate(resolve); });
  }
}

// A read that waits until the test lets it answer.
function held(answer) {
  let release;
  const promise = new Promise((resolve) => { release = () => resolve(answer); });
  return { promise, release };
}

describe('localChangeCheck tests', () => {
  beforeEach(() => {
    syncthingServiceMock.getDeviceId.reset();
    syncthingServiceMock.getDeviceId.resolves('LOCAL-DEVICE');
    syncthingServiceMock.getDbLocalChanged.reset();
    syncthingServiceMock.getDbLocalChanged.resolves({ files: [] });
    syncthingServiceMock.getDbFile.reset();
    syncthingServiceMock.getDbFile.resolves({ global: { localFlags: 0 } });
  });

  describe('stampOf', () => {
    it('is the same for the same folder, whatever order syncthing lists it in', () => {
      const one = localChangeCheck.stampOf({ sequence: 3, remoteSequence: { B: 2, A: 1 } }, [{ deviceID: 'Y' }, { deviceID: 'X' }]);
      const two = localChangeCheck.stampOf({ sequence: 3, remoteSequence: { A: 1, B: 2 } }, [{ deviceID: 'X' }, { deviceID: 'Y' }]);

      expect(one).to.equal(two);
    });

    [
      ['this node\'s sequence', { sequence: 4, remoteSequence: { A: 1 } }, [{ deviceID: 'X' }, { deviceID: 'Y' }]],
      ['another device\'s sequence', { sequence: 3, remoteSequence: { A: 2 } }, [{ deviceID: 'X' }, { deviceID: 'Y' }]],
      ['the devices the folder is shared with', { sequence: 3, remoteSequence: { A: 1 } }, [{ deviceID: 'X' }]],
    ].forEach(([what, status, devices]) => {
      it(`changes with ${what}`, () => {
        const before = localChangeCheck.stampOf({ sequence: 3, remoteSequence: { A: 1 } }, [{ deviceID: 'X' }, { deviceID: 'Y' }]);

        expect(localChangeCheck.stampOf(status, devices)).to.not.equal(before);
      });
    });
  });

  describe('request', () => {
    it('runs one check at a time on the node', async () => {
      const first = held({ files: [] });
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxa_a').returns(first.promise);
      const a = {};
      const b = {};

      localChangeCheck.request('fluxa_a', a, 's1', () => true);
      localChangeCheck.request('fluxb_b', b, 's1', () => true);
      await settled();

      sinon.assert.neverCalledWith(syncthingServiceMock.getDbLocalChanged, 'fluxb_b');
      first.release();
      await settled();
      expect(a.localChangeCheck).to.deep.equal({ stamp: 's1', onlyCopy: false, madeHere: false });
      expect(b.localChangeCheck).to.deep.equal({ stamp: 's1', onlyCopy: false, madeHere: false });
    });

    it('replaces a check still waiting with the newer one for the same folder', async () => {
      const first = held({ files: [] });
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxa_a').returns(first.promise);
      const b = {};

      localChangeCheck.request('fluxa_a', {}, 's1', () => true);
      localChangeCheck.request('fluxb_b', b, 'old', () => true);
      localChangeCheck.request('fluxb_b', b, 'new', () => true);
      first.release();
      await settled();

      expect(syncthingServiceMock.getDbLocalChanged.withArgs('fluxb_b').callCount, 'the folder was checked once per stamp asked for').to.equal(1);
      expect(b.localChangeCheck.stamp).to.equal('new');
    });

    it('does not start again a check already running for the same folder and stamp', async () => {
      const first = held({ files: [] });
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxa_a').returns(first.promise);
      const a = {};

      localChangeCheck.request('fluxa_a', a, 's1', () => true);
      await settled();
      localChangeCheck.request('fluxa_a', a, 's1', () => true);
      first.release();
      await settled();

      sinon.assert.calledOnce(syncthingServiceMock.getDbLocalChanged);
    });

    it('says when it has answered', async () => {
      const publish = sinon.stub(fluxEventBus, 'publish');
      try {
        localChangeCheck.request('fluxa_a', {}, 's1', () => true);
        await settled();

        sinon.assert.calledWithExactly(publish, 'syncthing:localChangesChecked', { folder: 'fluxa_a', onlyCopy: false, madeHere: false });
      } finally {
        publish.restore();
      }
    });
  });

  describe('examineLocalChanges', () => {
    it('asks about the items another device wrote, at most eight at once, and stops at the first only copy', async () => {
      const files = Array.from({ length: 20 }, (_, k) => ({ name: `f${k}`, version: ['PRIMARY:1'] }));
      syncthingServiceMock.getDbLocalChanged.resolves({ files });
      syncthingServiceMock.getDbFile.withArgs('fluxa_a', 'f9').resolves({ global: { localFlags: 8 } });

      expect(await localChangeCheck.examineLocalChanges('fluxa_a')).to.deep.equal({ onlyCopy: 'f9', madeHere: false });
      expect(syncthingServiceMock.getDbFile.callCount, 'asked past the batch that held it').to.equal(16);
    });

    it('says a change was made here, asking nothing about it', async () => {
      syncthingServiceMock.getDbLocalChanged.resolves({ files: [{ name: 'stray', version: ['LOCAL-D:4'] }] });

      expect(await localChangeCheck.examineLocalChanges('fluxa_a')).to.deep.equal({ onlyCopy: false, madeHere: true });
      sinon.assert.notCalled(syncthingServiceMock.getDbFile);
    });

    it('says a change was made here when it is on a later page than the changes others hold', async () => {
      const held = Array.from({ length: 1000 }, (_, k) => ({ name: `f${k}`, version: ['PRIMARY:1'] }));
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxa_a', 1).resolves({ files: held });
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxa_a', 2).resolves({ files: [{ name: 'stray', version: ['LOCAL-D:4'] }] });

      expect(await localChangeCheck.examineLocalChanges('fluxa_a')).to.deep.equal({ onlyCopy: false, madeHere: true });
    });

    it('says nothing was made here when every change names another device', async () => {
      syncthingServiceMock.getDbLocalChanged.resolves({ files: [{ name: 'f', version: ['PRIMARY:1', 'LOCAL-D:2'] }] });

      expect(await localChangeCheck.examineLocalChanges('fluxa_a')).to.deep.equal({ onlyCopy: false, madeHere: false });
    });

    it('cannot say when an item cannot be read', async () => {
      syncthingServiceMock.getDbLocalChanged.resolves({ files: [{ name: 'f', version: ['PRIMARY:1'] }] });
      syncthingServiceMock.getDbFile.rejects(new Error('404 No such object in the index'));

      expect(await localChangeCheck.examineLocalChanges('fluxa_a')).to.equal(null);
    });
  });
});
