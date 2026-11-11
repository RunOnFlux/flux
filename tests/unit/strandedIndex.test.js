const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('strandedIndex tests', () => {
  const FOLDER = 'fluxgame_app';
  const PRIMARY = '1.1.1.1:16127';
  const SELF = '3.3.3.3:16127';
  const DEVICE = 'PRIMARYDEVICE';
  const ITEM = 'backup/world/a.sav';
  const DIR = 'backup/world';
  const IdentityVerdict = { VERIFIED: 'verified', UNVERIFIABLE: 'unverifiable' };
  let strandedIndex;
  let syncthing;
  let writes;
  let identity;

  const answered = (records) => ({
    verdict: IdentityVerdict.VERIFIED, answer: { folder: FOLDER, records },
  });
  const deleteOf = (version) => ({ deleted: true, version });
  const twoPasses = async () => {
    await strandedIndex.repairIfStranded(FOLDER, PRIMARY, SELF);
    return strandedIndex.repairIfStranded(FOLDER, PRIMARY, SELF);
  };

  beforeEach(() => {
    syncthing = {
      refetchesDroppedDevices: sinon.stub().resolves(true),
      getDbStatus: sinon.stub().resolves({ state: 'idle', needTotalItems: 0 }),
      getConfigDevices: sinon.stub().resolves([{ deviceID: DEVICE, name: PRIMARY }, { deviceID: 'OTHER', name: '2.2.2.2:16127' }]),
      getDbCompletion: sinon.stub().resolves({ remoteState: 'valid', completion: 96 }),
      getDbRemoteNeed: sinon.stub().resolves({ files: [{ name: ITEM }, { name: DIR }] }),
      getDbFile: sinon.stub().resolves({ local: { deleted: false, version: ['KMX:574', 'LSS:573'] } }),
    };
    writes = {
      folderConfig: sinon.stub().resolves({ type: 'receiveonly', devices: [{ deviceID: DEVICE }, { deviceID: 'OTHER' }] }),
      refetchDeviceIndex: sinon.stub().resolves(true),
    };
    identity = {
      IdentityVerdict,
      AnswerPurpose: { FOLDER_RECORDS: 'fluxnodeFolderRecords' },
      askSigned: sinon.stub().resolves(answered({
        [ITEM]: deleteOf(['KMX:574', 'LSS:773']),
        [DIR]: deleteOf(['KMX:574', 'LSS:773']),
      })),
    };
    strandedIndex = proxyquire('../../ZelBack/src/services/appMonitoring/strandedIndex', {
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      '../syncthingService': syncthing,
      '../peerIdentityService': identity,
      './syncthingFolderWrites': writes,
      './peerFolderLiveness': { signedPeerRequest: sinon.stub().callsFake(async (_ip, challenge, fields) => ({ challenge, ...fields })) },
      '../utils/socketAddressUtils': { socketAddressesMatch: (a, b) => a === b },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('strictlyDominates', () => {
    const { strictlyDominates } = proxyquire('../../ZelBack/src/services/appMonitoring/strandedIndex', {
      '../../lib/log': {},
      '../syncthingService': {},
      '../peerIdentityService': {},
      './syncthingFolderWrites': {},
      './peerFolderLiveness': { signedPeerRequest: () => {} },
      '../utils/socketAddressUtils': {},
    });

    it('reads a higher counter of the same device as newer', () => {
      expect(strictlyDominates(['A:2'], ['A:1'])).to.equal(true);
    });

    it('reads another device\'s counter it carries as newer', () => {
      expect(strictlyDominates(['A:1', 'B:1'], ['A:1'])).to.equal(true);
    });

    it('does not read an equal version as newer', () => {
      expect(strictlyDominates(['A:1'], ['A:1'])).to.equal(false);
    });

    it('does not read an older version as newer', () => {
      expect(strictlyDominates(['A:1'], ['A:2'])).to.equal(false);
    });

    it('does not read a concurrent version as newer', () => {
      expect(strictlyDominates(['A:2'], ['A:1', 'B:1'])).to.equal(false);
    });

    it('compares counters as numbers', () => {
      expect(strictlyDominates(['A:10'], ['A:9'])).to.equal(true);
    });

    it('reads a device name containing a colon by its last one', () => {
      expect(strictlyDominates(['A:B:2'], ['A:B:1'])).to.equal(true);
    });
  });

  it('refetches a list that stands across two passes, every item a dominating delete', async () => {
    const first = await strandedIndex.repairIfStranded(FOLDER, PRIMARY, SELF);
    sinon.assert.notCalled(writes.refetchDeviceIndex);
    expect(first.code).to.equal('FIRST_SIGHTING');

    const second = await strandedIndex.repairIfStranded(FOLDER, PRIMARY, SELF);

    expect(second.code).to.equal('REFETCHED');
    sinon.assert.calledOnceWithExactly(writes.refetchDeviceIndex, FOLDER, DEVICE);
  });

  it('asks the primary about every item, in a request it signs as the node it is', async () => {
    await twoPasses();

    const [address, route, purpose, body] = identity.askSigned.firstCall.args;
    expect(address).to.equal(PRIMARY);
    expect(route).to.equal('/apps/folderrecords');
    expect(purpose).to.equal('fluxnodeFolderRecords');
    expect(await body('c0ffee')).to.deep.equal({
      challenge: 'c0ffee', folder: FOLDER, items: [ITEM, DIR], from: SELF,
    });
  });

  [
    ['a release that keeps a dropped device\'s sequence', () => syncthing.refetchesDroppedDevices.resolves(false), 'UNSUPPORTED_RELEASE'],
    ['a folder that sends', () => writes.folderConfig.resolves({ type: 'sendreceive', devices: [] }), 'NOT_A_STANDBY'],
    ['a folder syncthing does not hold', () => writes.folderConfig.resolves(null), 'NOT_A_STANDBY'],
    ['a folder syncing', () => syncthing.getDbStatus.resolves({ state: 'syncing', needTotalItems: 0 }), 'STILL_SYNCING'],
    ['a folder needing items', () => syncthing.getDbStatus.resolves({ state: 'idle', needTotalItems: 3 }), 'STILL_SYNCING'],
    ['a primary it has no device for', () => syncthing.getConfigDevices.resolves([]), 'PRIMARY_NOT_CONNECTED'],
    ['a primary not sharing the folder', () => writes.folderConfig.resolves({ type: 'receiveonly', devices: [{ deviceID: 'OTHER' }] }), 'PRIMARY_NOT_CONNECTED'],
    ['a primary not connected', () => syncthing.getDbCompletion.resolves({ remoteState: 'unknown' }), 'PRIMARY_NOT_CONNECTED'],
    ['a primary needing nothing', () => syncthing.getDbRemoteNeed.resolves({ files: [] }), 'NOTHING_STRANDED'],
  ].forEach(([name, arrange, code]) => {
    it(`does nothing for ${name}`, async () => {
      arrange();

      const result = await twoPasses();

      expect(result.code).to.equal(code);
      sinon.assert.notCalled(identity.askSigned);
      sinon.assert.notCalled(writes.refetchDeviceIndex);
    });
  });

  it('does nothing for more items than one lost batch', async () => {
    syncthing.getDbRemoteNeed.resolves({ files: Array.from({ length: strandedIndex.MAX_STRANDED_ITEMS + 1 }, (_v, i) => ({ name: `f${i}` })) });

    const result = await twoPasses();

    expect(result.code).to.equal('TOO_MANY_ITEMS');
    sinon.assert.notCalled(writes.refetchDeviceIndex);
  });

  it('reads every list syncthing can answer with', async () => {
    syncthing.getDbRemoteNeed.resolves({ progress: [{ name: 'p' }], queued: [{ name: 'q' }], rest: [{ name: 'r' }] });
    identity.askSigned.resolves(answered({
      p: deleteOf(['LSS:773']), q: deleteOf(['LSS:773']), r: deleteOf(['LSS:773']),
    }));
    syncthing.getDbFile.resolves({ local: { deleted: false, version: ['LSS:573'] } });

    expect((await twoPasses()).code).to.equal('REFETCHED');
  });

  it('starts counting again when the list moves between passes', async () => {
    await strandedIndex.repairIfStranded(FOLDER, PRIMARY, SELF);
    syncthing.getDbRemoteNeed.resolves({ files: [{ name: ITEM }] });

    const result = await strandedIndex.repairIfStranded(FOLDER, PRIMARY, SELF);

    expect(result.code).to.equal('FIRST_SIGHTING');
    sinon.assert.notCalled(identity.askSigned);
  });

  it('does not take the two sightings as consecutive across a clean pass', async () => {
    await strandedIndex.repairIfStranded(FOLDER, PRIMARY, SELF);
    syncthing.getDbRemoteNeed.resolves({ files: [] });
    await strandedIndex.repairIfStranded(FOLDER, PRIMARY, SELF);
    syncthing.getDbRemoteNeed.resolves({ files: [{ name: ITEM }, { name: DIR }] });

    const result = await strandedIndex.repairIfStranded(FOLDER, PRIMARY, SELF);

    expect(result.code).to.equal('FIRST_SIGHTING');
  });

  it('judges the list whatever order syncthing lists it in', async () => {
    await strandedIndex.repairIfStranded(FOLDER, PRIMARY, SELF);
    syncthing.getDbRemoteNeed.resolves({ files: [{ name: DIR }, { name: ITEM }] });

    expect((await strandedIndex.repairIfStranded(FOLDER, PRIMARY)).code).to.equal('REFETCHED');
  });

  it('does not act on an unproven answer', async () => {
    identity.askSigned.resolves({ verdict: IdentityVerdict.UNVERIFIABLE });

    expect((await twoPasses()).code).to.equal('PRIMARY_UNPROVEN');
    sinon.assert.notCalled(writes.refetchDeviceIndex);
  });

  it('does not act on an unproven answer that says everything it would need to', async () => {
    identity.askSigned.resolves({
      verdict: IdentityVerdict.UNVERIFIABLE,
      answer: {
        folder: FOLDER,
        records: { [ITEM]: deleteOf(['KMX:574', 'LSS:773']), [DIR]: deleteOf(['KMX:574', 'LSS:773']) },
      },
    });

    expect((await twoPasses()).code).to.equal('PRIMARY_UNPROVEN');
    sinon.assert.notCalled(writes.refetchDeviceIndex);
  });

  it('does not act on an answer about another folder', async () => {
    identity.askSigned.resolves({ verdict: IdentityVerdict.VERIFIED, answer: { folder: 'other', records: {} } });

    expect((await twoPasses()).code).to.equal('PRIMARY_UNPROVEN');
  });

  [
    ['a primary with no record of an item: the empty primary', { [DIR]: deleteOf(['KMX:574', 'LSS:773']) }],
    ['a record that is not a delete: a primary behind', {
      [ITEM]: { deleted: false, version: ['KMX:574', 'LSS:773'] },
      [DIR]: deleteOf(['KMX:574', 'LSS:773']),
    }],
    ['a delete this copy is newer than', {
      [ITEM]: deleteOf(['KMX:500', 'LSS:573']),
      [DIR]: deleteOf(['KMX:574', 'LSS:773']),
    }],
    ['a delete concurrent with this copy', {
      [ITEM]: deleteOf(['LSS:773']),
      [DIR]: deleteOf(['KMX:574', 'LSS:773']),
    }],
    ['one item failing among good ones', {
      [ITEM]: deleteOf(['KMX:574', 'LSS:773']),
      [DIR]: { deleted: false, version: ['KMX:574', 'LSS:573'] },
    }],
  ].forEach(([name, records]) => {
    it(`refuses ${name}`, async () => {
      identity.askSigned.resolves(answered(records));

      expect((await twoPasses()).code).to.equal('NOT_A_LOST_DELETE');
      sinon.assert.notCalled(writes.refetchDeviceIndex);
    });
  });

  it('refuses an item this node has no record of', async () => {
    syncthing.getDbFile.resolves({});

    expect((await twoPasses()).code).to.equal('NOT_A_LOST_DELETE');
  });

  it('refuses an item this node already has as deleted', async () => {
    syncthing.getDbFile.resolves({ local: { deleted: true, version: ['KMX:574', 'LSS:573'] } });

    expect((await twoPasses()).code).to.equal('NOT_A_LOST_DELETE');
  });

  it('says so when the refetch does not land, and sees the folder afresh', async () => {
    writes.refetchDeviceIndex.resolves(false);

    expect((await twoPasses()).code).to.equal('REFETCH_FAILED');
    expect((await strandedIndex.repairIfStranded(FOLDER, PRIMARY)).code).to.equal('FIRST_SIGHTING');
  });

  it('keeps each folder\'s sightings apart', async () => {
    await strandedIndex.repairIfStranded(FOLDER, PRIMARY, SELF);

    expect((await strandedIndex.repairIfStranded('fluxother_app', PRIMARY)).code).to.equal('FIRST_SIGHTING');
  });
});
