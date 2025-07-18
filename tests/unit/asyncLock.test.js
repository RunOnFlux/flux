const { expect } = require('chai');
const sinon = require('sinon');

const { AsyncLock } = require('../../ZelBack/src/services/utils/asyncLock');

describe('asyncLock tests', () => {
  beforeEach(async () => { });

  afterEach(() => {
    sinon.restore();
  });

  it('should instantiate and not be locked', () => {
    const asyncLock = new AsyncLock();

    expect(asyncLock.locked).to.be.false;
  });

  it('should set locked when enabled', async () => {
    const asyncLock = new AsyncLock();

    await asyncLock.enable();

    expect(asyncLock.locked).to.be.true;
  });

  it('should resolve immediately when ready awaited and not locked', async () => {
    const asyncLock = new AsyncLock();
    await asyncLock.waitReady();
  });

  it('should resolve eventually when ready awaited and locked', async () => {
    const clock = sinon.useFakeTimers();

    const asyncLock = new AsyncLock();
    let testVar = false;

    const tester = async () => {
      await asyncLock.waitReady();
      testVar = true;
    };

    await asyncLock.enable();
    setTimeout(() => asyncLock.disable(), 5000);
    const promise = tester();
    expect(testVar).to.be.false;
    await clock.tickAsync(4000);
    expect(testVar).to.be.false;
    await clock.tickAsync(1000);
    expect(testVar).to.be.true;
    await promise;
  });

  it('should wait if enable called and already locked', async () => {
    const clock = sinon.useFakeTimers();

    const asyncLock = new AsyncLock();
    let testVar = false;

    const tester = async () => {
      await asyncLock.enable();
      testVar = true;
    };

    await asyncLock.enable();
    setTimeout(() => asyncLock.disable(), 5000);
    tester();
    expect(testVar).to.be.false;
    await clock.tickAsync(4000);
    expect(testVar).to.be.false;
    await clock.tickAsync(1000);
    expect(testVar).to.be.true;
  });

  it('should run waiters in order if multiple waiters on the lock', async () => {
    const clock = sinon.useFakeTimers();

    const asyncLock = new AsyncLock();
    const results = { 1: false, 2: false, 3: false };

    const tester = async (id) => {
      await asyncLock.enable();

      await new Promise((r) => { setTimeout(r, 1000); });
      results[id] = true;
      asyncLock.disable();
    };

    expect(results[1]).to.be.false;
    expect(results[2]).to.be.false;
    expect(results[3]).to.be.false;
    expect(asyncLock.waiterCount).to.be.equal(0);

    const promise1 = tester(1);
    const promise2 = tester(2);
    const promise3 = tester(3);

    expect(asyncLock.waiterCount).to.be.equal(2);

    await clock.tickAsync(1000);

    expect(results[1]).to.be.true;
    expect(results[2]).to.be.false;
    expect(results[3]).to.be.false;

    await promise1;

    expect(asyncLock.waiterCount).to.be.equal(1);

    await clock.tickAsync(1000);

    expect(results[1]).to.be.true;
    expect(results[2]).to.be.true;
    expect(results[3]).to.be.false;

    await promise2;

    expect(asyncLock.waiterCount).to.be.equal(0);

    await clock.tickAsync(1000);

    expect(results[1]).to.be.true;
    expect(results[2]).to.be.true;
    expect(results[3]).to.be.true;

    await promise3;
  });

  it('should resolve when waitReady called and existing enables have cleared', async () => {
    const clock = sinon.useFakeTimers();

    const asyncLock = new AsyncLock();

    const tester = async () => {
      await asyncLock.enable();

      await new Promise((r) => { setTimeout(r, 1000); });
      asyncLock.disable();
    };

    let waiterSet = false;

    const waiter = async () => {
      await asyncLock.waitReady({ waitAll: false });
      waiterSet = true;
    };

    const promise1 = tester();
    const promise2 = tester();
    const promise3 = tester();
    const waiterPromise = waiter();
    const promise4 = tester();

    expect(asyncLock.locked).to.be.true;
    expect(asyncLock.waiterCount).to.be.equal(3);

    await clock.tickAsync(1000);
    await promise1;

    expect(waiterSet).to.be.false;

    await clock.tickAsync(1000);
    await promise2;

    expect(waiterSet).to.be.false;

    await clock.tickAsync(1000);
    await promise3;

    await waiterPromise;
    expect(waiterSet).to.be.true;

    // cleanup
    await clock.tickAsync(1000);
    await promise4;
  });

  it('should only resolve waitReady when all enabled have cleared', async () => {
    const clock = sinon.useFakeTimers();

    const asyncLock = new AsyncLock();

    const tester = async () => {
      await asyncLock.enable();

      await new Promise((r) => { setTimeout(r, 1000); });
      asyncLock.disable();
    };

    let waiterSet = false;

    const waiter = async () => {
      await asyncLock.waitReady({ waitAll: true });
      waiterSet = true;
    };

    const promise1 = tester();
    const promise2 = tester();
    const promise3 = tester();
    const waiterPromise = waiter();
    const promise4 = tester();

    expect(asyncLock.locked).to.be.true;
    expect(asyncLock.waiterCount).to.be.equal(3);

    await clock.tickAsync(1000);
    await promise1;

    expect(waiterSet).to.be.false;

    await clock.tickAsync(1000);
    await promise2;

    expect(waiterSet).to.be.false;

    await clock.tickAsync(1000);
    await promise3;

    expect(waiterSet).to.be.false;

    await clock.tickAsync(1000);
    await promise4;

    expect(waiterSet).to.be.true;
    await waiterPromise;
  });

  it('should set unlocked and resolve immediately if lock disabled', async () => {
    const asyncLock = new AsyncLock();
    await asyncLock.enable();
    asyncLock.disable();

    expect(asyncLock.locked).to.be.false;
    await asyncLock.waitReady();
  });

  it('should wait and unlock lock after timeout if not unlocked prior', async () => {
    const clock = sinon.useFakeTimers();
    const timeout = 3_000;
    const asyncLock = new AsyncLock();

    let testVar = false;

    const tester = async () => {
      await asyncLock.enable();
      await asyncLock.unlockTimeout(timeout);
      testVar = true;
    };

    expect(asyncLock.locked).to.be.false;

    const promise = tester();

    await clock.tickAsync(2_900);
    expect(asyncLock.locked).to.be.true;
    expect(testVar).to.be.false;

    await clock.tickAsync(100);
    await promise;
    expect(asyncLock.locked).to.be.false;
    expect(testVar).to.be.true;
  });

  it('should wait for lock with timeout and not unlock lock', async () => {
    const clock = sinon.useFakeTimers();
    const timeout = 3_000;
    const asyncLock = new AsyncLock();

    let testVar = false;

    const tester = async () => {
      await asyncLock.enable();
      await asyncLock.readyTimeout(timeout);
      testVar = true;
    };

    expect(asyncLock.locked).to.be.false;

    const promise = tester();

    await clock.tickAsync(2_900);
    expect(asyncLock.locked).to.be.true;
    expect(testVar).to.be.false;

    await clock.tickAsync(100);
    await promise;
    expect(asyncLock.locked).to.be.true;
    expect(testVar).to.be.true;
  });
});
