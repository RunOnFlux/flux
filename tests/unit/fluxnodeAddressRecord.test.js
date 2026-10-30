const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
const { expect } = chai;
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const fluxnodeAddressRecord = require('../../ZelBack/src/services/fluxnodeAddressRecord');
const { requireMongo } = require('./dbTestHelper');

describe('fluxnodeAddressRecord', () => {
  before(requireMongo);

  const A = { txhash: 'cc'.repeat(32), outidx: '0' };
  const B = { txhash: 'dd'.repeat(32), outidx: '3' };
  const idOf = ({ txhash, outidx }) => fluxnodeAddressRecord.collateralOf(txhash, outidx);
  let database;
  let records;
  // each test's blocks sit above every block recorded before it
  let base = 7_000_000;

  const confirmation = (collateral, ip) => ({
    version: 5, type: 'Confirming a fluxnode', txhash: collateral.txhash, outidx: collateral.outidx, ip,
  });
  const block = (height, txs, confirmations = 1) => fluxnodeAddressRecord.recordBlock({ height, confirmations, tx: txs });
  const recordOf = (collateral) => records.findOne({ _id: idOf(collateral) });

  beforeEach(async () => {
    await dbHelper.initiateDB();
    database = dbHelper.databaseConnection().db(config.database.daemon.database);
    records = database.collection(config.database.daemon.collections.fluxnodeAddresses);
    // dropped, so the heights it has recorded go with it
    await fluxnodeAddressRecord.drop(database);
    base += 10_000;
  });

  afterEach(async () => {
    sinon.restore();
    await records.deleteMany({});
  });

  it('records a node at the address it first confirms at, with no change', async () => {
    await block(base, [confirmation(A, '203.0.113.1:16137')]);

    const record = await recordOf(A);
    expect(record).to.include({ ip: '203.0.113.1:16137', height: base, firstHeight: base });
    expect(record.changes).to.deep.equal([]);
  });

  it('records a bare ip at the default port', async () => {
    await block(base, [confirmation(A, '203.0.113.1')]);

    expect((await recordOf(A)).ip).to.equal('203.0.113.1:16127');
  });

  it('moves a confirmation at the same address to its block, recording no change', async () => {
    await block(base, [confirmation(A, '203.0.113.1:16127')]);
    await block(base + 500, [confirmation(A, '203.0.113.1')]);

    const record = await recordOf(A);
    expect(record).to.include({ ip: '203.0.113.1:16127', height: base + 500 });
    expect(record.changes).to.deep.equal([]);
  });

  it('records a confirmation at another address as a change from the one before', async () => {
    await block(base, [confirmation(A, '203.0.113.1:16127')]);
    await block(base + 10, [confirmation(A, '203.0.113.2:16127'), confirmation(B, '203.0.113.9:16127')]);

    const record = await recordOf(A);
    expect(record.ip).to.equal('203.0.113.2:16127');
    expect(record.changes).to.deep.equal([{ from: '203.0.113.1:16127', to: '203.0.113.2:16127', height: base + 10 }]);
    expect(await fluxnodeAddressRecord.movedBetween(idOf(A), '203.0.113.1', '203.0.113.2:16127')).to.equal(true);
    expect(await fluxnodeAddressRecord.movedBetween(idOf(A), '203.0.113.2:16127', '203.0.113.1:16127')).to.equal(false);
    expect(await fluxnodeAddressRecord.movedBetween(idOf(B), '203.0.113.1:16127', '203.0.113.2:16127')).to.equal(false);
  });

  it('records a block processed again once', async () => {
    await block(base, [confirmation(A, '203.0.113.1:16127')]);
    await block(base + 10, [confirmation(A, '203.0.113.2:16127')]);
    await block(base + 10, [confirmation(A, '203.0.113.2:16127')]);

    expect((await recordOf(A)).changes).to.have.length(1);
  });

  it('drops a change 640 blocks after it was made, when the next change is recorded', async () => {
    await block(base, [confirmation(A, '203.0.113.1:16127')]);
    await block(base + 10, [confirmation(A, '203.0.113.2:16127')]);
    await block(base + 300, [confirmation(A, '203.0.113.3:16127')]);
    await block(base + 650, [confirmation(A, '203.0.113.4:16127')]);

    expect((await recordOf(A)).changes.map((change) => change.height)).to.deep.equal([base + 300, base + 650]);
  });

  it('proves a move for 640 blocks after it was made, while the node confirms at its new address', async () => {
    await block(base, [confirmation(A, '203.0.113.1:16127')]);
    await block(base + 10, [confirmation(A, '203.0.113.2:16127')]);
    await block(base + 649, [confirmation(A, '203.0.113.2:16127')]);
    expect(await fluxnodeAddressRecord.movedBetween(idOf(A), '203.0.113.1:16127', '203.0.113.2:16127'), 'within 640 blocks').to.equal(true);

    await block(base + 650, [confirmation(A, '203.0.113.2:16127')]);

    expect(await fluxnodeAddressRecord.movedBetween(idOf(A), '203.0.113.1:16127', '203.0.113.2:16127')).to.equal(false);
  });

  it('drops a node that has not confirmed for 640 blocks', async () => {
    await block(base, [confirmation(A, '203.0.113.1:16127')]);
    await block(base + 300, [confirmation(B, '203.0.113.9:16127')]);
    expect(await recordOf(A), 'still within 640 blocks').to.not.equal(null);

    await block(base + 641, []);

    expect(await recordOf(A)).to.equal(null);
    expect(await recordOf(B)).to.not.equal(null);
  });

  it('starts again at the first block it can hold after passing one deeper than it reaches', async () => {
    await block(base, [confirmation(A, '203.0.113.1:16127')]);
    await block(base + 10, [confirmation(A, '203.0.113.1:16127')], fluxnodeAddressRecord.RECORD_BLOCKS + 1);
    expect(await recordOf(A), 'a record from before the skipped block').to.equal(null);

    await block(base + 300, [confirmation(A, '203.0.113.2:16127')]);

    const record = await recordOf(A);
    expect(record).to.include({ ip: '203.0.113.2:16127', firstHeight: base + 300 });
    expect(record.changes, 'the first confirmation after the skipped block logged as a change').to.deep.equal([]);
    expect(await fluxnodeAddressRecord.whenRecorded(base + 300, 1)).to.equal(true);
  });

  it('records nothing from a block deeper than the record reaches', async () => {
    await block(base, [confirmation(A, '203.0.113.1:16127')], fluxnodeAddressRecord.RECORD_BLOCKS + 1);
    expect(await recordOf(A)).to.equal(null);

    await block(base + 1, [confirmation(A, '203.0.113.1:16127')], fluxnodeAddressRecord.RECORD_BLOCKS);
    expect(await recordOf(A)).to.not.equal(null);
  });

  it('ignores a transaction that is not a fluxnode start or confirmation', async () => {
    await block(base, [{ version: 4, txid: 'ee'.repeat(32), vout: [] }, { version: 5, txhash: A.txhash, outidx: '0' }]);

    expect(await records.countDocuments({})).to.equal(0);
  });

  describe('rebuild', () => {
    const tip = () => base + 500;
    // The chain: A confirms at one address, then moves; B confirms once.
    const chain = (height) => {
      const txs = [];
      if (height === base) txs.push(confirmation(A, '203.0.113.1:16127'));
      if (height === base + 300) txs.push(confirmation(B, '203.0.113.9:16127'));
      if (height === base + 400) txs.push(confirmation(A, '203.0.113.2:16127'));
      return { height, confirmations: tip() - height + 1, tx: txs };
    };

    it('proves a move by a node that last confirmed before the explorer first kept the record', async () => {
      expect(await fluxnodeAddressRecord.isBuilt(), 'an empty record reads as built').to.equal(false);

      await fluxnodeAddressRecord.rebuild(tip(), async (height) => chain(height), database);

      expect(await fluxnodeAddressRecord.isBuilt()).to.equal(true);
      expect(await fluxnodeAddressRecord.movedBetween(idOf(A), '203.0.113.1:16127', '203.0.113.2:16127')).to.equal(true);
      expect((await recordOf(B)).ip).to.equal('203.0.113.9:16127');
      expect(await fluxnodeAddressRecord.whenRecorded(tip(), 1)).to.equal(true);
    });

    it('a canary: the same chain recorded from the tip only proves no move', async () => {
      await block(base + 400, [confirmation(A, '203.0.113.2:16127')]);

      expect(await fluxnodeAddressRecord.movedBetween(idOf(A), '203.0.113.1:16127', '203.0.113.2:16127')).to.equal(false);
    });

    it('leaves the record as it was when it stops part way, and the next rebuild builds it whole', async () => {
      await block(base + 450, [confirmation(B, '198.51.100.7:16127')], 51);

      const failing = async (height) => {
        if (height === base + 350) throw new Error('daemon gone');
        return chain(height);
      };
      await expect(fluxnodeAddressRecord.rebuild(tip(), failing, database)).to.be.rejectedWith('daemon gone');

      expect((await recordOf(B)).ip, 'a reader saw the record part built').to.equal('198.51.100.7:16127');
      expect(await recordOf(A)).to.equal(null);

      await fluxnodeAddressRecord.rebuild(tip(), async (height) => chain(height), database);

      expect((await recordOf(A)).changes).to.deep.equal([{ from: '203.0.113.1:16127', to: '203.0.113.2:16127', height: base + 400 }]);
      expect((await recordOf(B)).ip).to.equal('203.0.113.9:16127');
    });

    it('builds the record the explorer writes from the same blocks, one at a time', async () => {
      // A moves twice, the first change old enough to drop by the second; B
      // confirms once; C misses the confirmations that keep it listed and comes
      // back as a new node.
      const C = { txhash: 'ee'.repeat(32), outidx: '1' };
      const first = tip() - fluxnodeAddressRecord.RECORD_BLOCKS + 1;
      const events = new Map([
        [first, [confirmation(A, '203.0.113.1:16127'), confirmation(C, '198.51.100.1:16127')]],
        [first + 100, [confirmation(A, '203.0.113.2:16127')]],
        [base + 200, [confirmation(A, '203.0.113.2:16127')]],
        [base + 300, [confirmation(B, '203.0.113.9:16127'), confirmation(C, '198.51.100.2:16127')]],
        [base + 400, [confirmation(A, '203.0.113.3:16127')]],
      ]);
      const blockAt = (height) => ({ height, confirmations: tip() - height + 1, tx: events.get(height) ?? [] });
      // The explorer's writes, against a collection held in memory.
      const held = new Map();
      const live = {
        find: ({ _id: { $in: ids } }) => ({ toArray: async () => ids.filter((id) => held.has(id)).map((id) => ({ _id: id, ...held.get(id) })) }),
        bulkWrite: async (writes) => writes.forEach(({ replaceOne: { filter, replacement } }) => held.set(filter._id, replacement)),
        deleteMany: async ({ height: { $lt: below } }) => held.forEach((record, id) => { if (record.height < below) held.delete(id); }),
      };
      for (let height = first; height <= tip(); height += 1) {
        // eslint-disable-next-line no-await-in-loop
        await fluxnodeAddressRecord.writeBlock(blockAt(height), live);
      }

      await fluxnodeAddressRecord.rebuild(tip(), async (height) => blockAt(height), database);

      const rebuilt = await records.find({}).sort({ _id: 1 }).toArray();
      expect(rebuilt).to.deep.equal([...held].map(([_id, record]) => ({ _id, ...record })).sort((x, y) => x._id.localeCompare(y._id)));
      expect((await recordOf(A)).changes, 'the change older than a node\'s confirmations was kept').to.deep.equal([{ from: '203.0.113.2:16127', to: '203.0.113.3:16127', height: base + 400 }]);
      expect((await recordOf(C)).firstHeight, 'a node that left the list kept its old record').to.equal(base + 300);
    });

    it('carries the record\'s indexes', async () => {
      await fluxnodeAddressRecord.rebuild(tip(), async (height) => chain(height), database);

      const names = (await records.indexes()).map((index) => index.name);
      expect(names).to.include('records by the block of their last confirmation');
    });
  });

  describe('restoreToHeight', () => {
    it('returns a node to the address it held at the height restored to', async () => {
      await block(base, [confirmation(A, '203.0.113.1:16127')]);
      await block(base + 10, [confirmation(A, '203.0.113.2:16127')]);
      await block(base + 20, [confirmation(A, '203.0.113.3:16127')]);

      await fluxnodeAddressRecord.restoreToHeight(base + 15, database);

      const record = await recordOf(A);
      expect(record.ip).to.equal('203.0.113.2:16127');
      expect(record.height).to.equal(base + 15);
      expect(record.changes.map((change) => change.to)).to.deep.equal(['203.0.113.2:16127']);
      expect(await fluxnodeAddressRecord.movedBetween(idOf(A), '203.0.113.2:16127', '203.0.113.3:16127')).to.equal(false);
    });

    it('drops a node first confirmed above the height restored to', async () => {
      await block(base, [confirmation(A, '203.0.113.1:16127')]);
      await block(base + 10, [confirmation(B, '203.0.113.9:16127')]);

      await fluxnodeAddressRecord.restoreToHeight(base + 5, database);

      expect(await recordOf(A)).to.not.equal(null);
      expect(await recordOf(B)).to.equal(null);
    });

    it('records the blocks processed again after it', async () => {
      await block(base, [confirmation(A, '203.0.113.1:16127')]);
      await block(base + 10, [confirmation(A, '203.0.113.2:16127')]);
      await fluxnodeAddressRecord.restoreToHeight(base + 5, database);

      await block(base + 10, [confirmation(A, '203.0.113.5:16127')]);

      expect((await recordOf(A)).changes).to.deep.equal([{ from: '203.0.113.1:16127', to: '203.0.113.5:16127', height: base + 10 }]);
    });
  });

  describe('whenRecorded', () => {
    it('resolves at once for a block already recorded', async () => {
      await block(base, []);

      expect(await fluxnodeAddressRecord.whenRecorded(base, 1)).to.equal(true);
    });

    it('resolves once the block is recorded', async () => {
      await block(base, []);
      const reached = fluxnodeAddressRecord.whenRecorded(base + 1, 10_000);

      await block(base + 1, []);

      expect(await reached).to.equal(true);
    });

    it('resolves false when the block is not recorded in time', async () => {
      await block(base, []);

      expect(await fluxnodeAddressRecord.whenRecorded(base + 1, 20)).to.equal(false);
    });

    it('resolves for every block up to the height the explorer resumes at, and no further', async () => {
      const reached = fluxnodeAddressRecord.whenRecorded(base, 10_000);

      fluxnodeAddressRecord.resumeAt(base);

      expect(await reached).to.equal(true);
      expect(await fluxnodeAddressRecord.whenRecorded(base - 100, 1)).to.equal(true);
      expect(await fluxnodeAddressRecord.whenRecorded(base + 1, 20)).to.equal(false);
    });
  });

  it('is dropped whole, and rebuilt from the blocks recorded after', async () => {
    await block(base, [confirmation(A, '203.0.113.1:16127')]);

    await fluxnodeAddressRecord.drop(database);
    expect(await records.countDocuments({})).to.equal(0);
    expect(await fluxnodeAddressRecord.whenRecorded(base, 20), 'nothing is recorded once dropped').to.equal(false);

    await block(base + 1, [confirmation(A, '203.0.113.1:16127')]);
    expect(await recordOf(A)).to.not.equal(null);
  });
});
