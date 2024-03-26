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
    await asyncLock.ready;
  });

  it('should resolve eventually when ready awaited and locked', async () => {
    const clock = sinon.useFakeTimers();

    const asyncLock = new AsyncLock();
    let testVar = false;

    const tester = async () => {
      await asyncLock.ready;
      testVar = true;
    };

    await asyncLock.enable();
    setTimeout(asyncLock.disable, 5000);
    tester();
    expect(testVar).to.be.false;
    await clock.tickAsync(4000);
    expect(testVar).to.be.false;
    await clock.tickAsync(1000);
    expect(testVar).to.be.true;
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
    setTimeout(asyncLock.disable, 5000);
    tester();
    expect(testVar).to.be.false;
    await clock.tickAsync(4000);
    expect(testVar).to.be.false;
    await clock.tickAsync(1000);
    expect(testVar).to.be.true;
  });

  it('should set unlocked and resolve immediately if lock disabled', async () => {
    const asyncLock = new AsyncLock();
    await asyncLock.enable();
    asyncLock.disable();

    expect(asyncLock.locked).to.be.false;
    await asyncLock.ready;
  });
});
