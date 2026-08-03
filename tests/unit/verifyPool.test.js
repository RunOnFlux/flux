const chai = require('chai');
const sinon = require('sinon');

const { expect } = chai;

const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const verifyPool = require('../../ZelBack/src/services/utils/verifyPool');

const TEST_PUBKEY = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
const TEST_PRIVKEY = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';

function createSignedBroadcast(data) {
  const version = 1;
  const timestamp = Date.now();
  const message = serviceHelper.ensureString(data);
  const messageToSign = version + message + timestamp;
  const signature = verificationHelper.signMessage(messageToSign, TEST_PRIVKEY);
  return {
    messageToVerify: String(version) + message + String(timestamp),
    pubKey: TEST_PUBKEY,
    signature,
  };
}

describe('verifyPool tests', () => {
  before(() => {
    verifyPool.start(2);
  });

  after(() => {
    verifyPool.stop();
  });

  it('should verify a single valid broadcast', async () => {
    const item = createSignedBroadcast({ type: 'fluxappinstallingerror', ip: '1.2.3.4', name: 'testapp' });
    const results = await verifyPool.verify([item]);
    expect(results).to.deep.equal([true]);
  });

  it('should verify a batch of valid broadcasts', async () => {
    const items = [];
    for (let i = 0; i < 20; i++) {
      items.push(createSignedBroadcast({ type: 'fluxappinstallingerror', ip: `1.2.3.${i}`, name: 'testapp' }));
    }
    const results = await verifyPool.verify(items);
    expect(results.length).to.equal(20);
    expect(results.every(Boolean)).to.equal(true);
  });

  it('should return false for broadcasts with tampered data', async () => {
    const item = createSignedBroadcast({ type: 'fluxappinstallingerror', ip: '1.2.3.4', name: 'testapp' });
    item.messageToVerify = item.messageToVerify.replace('testapp', 'hackedapp');
    const results = await verifyPool.verify([item]);
    expect(results).to.deep.equal([false]);
  });

  it('should return false for broadcasts with invalid signature', async () => {
    const item = createSignedBroadcast({ type: 'fluxappinstallingerror', ip: '1.2.3.4', name: 'testapp' });
    item.signature = 'invalidsignature';
    const results = await verifyPool.verify([item]);
    expect(results).to.deep.equal([false]);
  });

  it('should handle mixed valid and invalid broadcasts', async () => {
    const valid = createSignedBroadcast({ type: 'fluxappinstallingerror', ip: '1.2.3.4', name: 'app1' });
    const invalid = createSignedBroadcast({ type: 'fluxappinstallingerror', ip: '5.6.7.8', name: 'app2' });
    invalid.signature = 'bad';
    const results = await verifyPool.verify([valid, invalid, valid]);
    expect(results).to.deep.equal([true, false, true]);
  });

  it('should handle concurrent verify calls without mixing results', async () => {
    const batchA = [];
    const batchB = [];
    for (let i = 0; i < 10; i++) {
      batchA.push(createSignedBroadcast({ type: 'fluxappinstallingerror', ip: `10.0.0.${i}`, name: 'appA' }));
      batchB.push(createSignedBroadcast({ type: 'fluxappinstallingerror', ip: `20.0.0.${i}`, name: 'appB' }));
    }
    // Tamper with batch B items 5-9
    for (let i = 5; i < 10; i++) {
      batchB[i].signature = 'bad';
    }

    const [resultsA, resultsB] = await Promise.all([
      verifyPool.verify(batchA),
      verifyPool.verify(batchB),
    ]);

    expect(resultsA.every(Boolean)).to.equal(true);
    expect(resultsB.slice(0, 5).every(Boolean)).to.equal(true);
    expect(resultsB.slice(5).every((r) => r === false)).to.equal(true);
  });

  it('should handle empty input', async () => {
    const results = await verifyPool.verify([]);
    expect(results).to.deep.equal([]);
  });

  describe('elastic sizing', () => {
    // 256 items per chunk, so this batch is five chunks of work
    const CHUNKS_IN_LARGE_BATCH = 5;
    const LARGE_BATCH = 256 * CHUNKS_IN_LARGE_BATCH;

    function repeatedBatch(size) {
      const item = createSignedBroadcast({ type: 'fluxappinstallingerror', ip: '1.2.3.4', name: 'bulk' });
      return Array.from({ length: size }, () => item);
    }

    it('should raise workers to match the chunks a batch splits into', async () => {
      const { maxWorkers } = verifyPool.stats();
      const pending = verifyPool.verify(repeatedBatch(LARGE_BATCH));

      // sizing happens before the first await, so the pool is already scaled.
      // Read it now, but always drain before asserting - an assertion thrown
      // with work in flight would leave the pool dirty for the next test
      const scaledTo = verifyPool.stats().workers;
      const results = await pending;

      expect(scaledTo).to.equal(Math.min(maxWorkers, CHUNKS_IN_LARGE_BATCH));
      expect(results.length).to.equal(LARGE_BATCH);
      expect(results.every(Boolean)).to.equal(true);
    });

    it('should not raise more workers than there are spare cores', async () => {
      const { maxWorkers } = verifyPool.stats();
      const item = createSignedBroadcast({ type: 'fluxappinstallingerror', ip: '1.2.3.4', name: 'depth' });

      // queue depth, not batch size, is what drives sizing here: nothing can
      // complete while these calls are still being issued
      const pending = [];
      for (let i = 0; i < maxWorkers + 5; i++) {
        pending.push(verifyPool.verify([item]));
      }

      const scaledTo = verifyPool.stats().workers;
      const results = await Promise.all(pending);

      expect(scaledTo).to.equal(maxWorkers);
      expect(results.every((result) => result[0] === true)).to.equal(true);
    });

    it('should preserve item order across chunk boundaries', async () => {
      const items = repeatedBatch(LARGE_BATCH).map((item) => ({ ...item }));
      const tampered = [0, 255, 256, 700, LARGE_BATCH - 1];
      tampered.forEach((index) => { items[index].signature = 'bad'; });

      const results = await verifyPool.verify(items);

      expect(results.length).to.equal(LARGE_BATCH);
      results.forEach((result, index) => {
        expect(result).to.equal(!tampered.includes(index));
      });
    });

    it('should release the extra workers once the burst is over', async () => {
      const clock = sinon.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout'],
        shouldClearNativeTimers: true,
      });
      try {
        await verifyPool.verify(repeatedBatch(LARGE_BATCH));
        expect(verifyPool.stats().workers).to.be.above(1);

        clock.tick(60001);

        expect(verifyPool.stats().workers).to.equal(1);
        expect(verifyPool.stats().busy).to.equal(0);
      } finally {
        clock.restore();
      }
    });
  });
});
