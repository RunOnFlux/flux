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

  it('should default to maxConcurrent=1 (backward compat)', async () => {
    const asyncLock = new AsyncLock();
    let secondEnabled = false;

    await asyncLock.enable();

    const p = (async () => {
      await asyncLock.enable();
      secondEnabled = true;
    })();

    // Second enable should be blocked (mutex behavior)
    await new Promise((r) => { setTimeout(r, 0); });
    expect(secondEnabled).to.be.false;

    asyncLock.disable();
    await p;
    expect(secondEnabled).to.be.true;
    asyncLock.disable();
  });

  it('should allow N concurrent holders with maxConcurrent', async () => {
    const asyncLock = new AsyncLock(3);
    const enabled = [false, false, false, false];

    const enableAndMark = async (index) => {
      await asyncLock.enable();
      enabled[index] = true;
    };

    const p1 = enableAndMark(0);
    const p2 = enableAndMark(1);
    const p3 = enableAndMark(2);

    // Let microtasks flush
    await new Promise((r) => { setTimeout(r, 0); });

    // First 3 should all proceed without blocking
    expect(enabled[0]).to.be.true;
    expect(enabled[1]).to.be.true;
    expect(enabled[2]).to.be.true;

    // 4th should block
    const p4 = enableAndMark(3);
    await new Promise((r) => { setTimeout(r, 0); });
    expect(enabled[3]).to.be.false;

    // Free a slot
    asyncLock.disable();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(enabled[3]).to.be.true;

    // Cleanup
    asyncLock.disable();
    asyncLock.disable();
    asyncLock.disable();
    await Promise.all([p1, p2, p3, p4]);
  });

  it('should unblock waiters in order with maxConcurrent', async () => {
    const clock = sinon.useFakeTimers();
    const asyncLock = new AsyncLock(2);
    const results = { 1: false, 2: false, 3: false, 4: false, 5: false };

    const tester = async (id) => {
      await asyncLock.enable();
      await new Promise((r) => { setTimeout(r, 1000); });
      results[id] = true;
      asyncLock.disable();
    };

    // Holders 1 and 2 get slots immediately
    const p1 = tester(1);
    const p2 = tester(2);
    // Holders 3, 4, 5 must wait
    const p3 = tester(3);
    const p4 = tester(4);
    const p5 = tester(5);

    expect(asyncLock.waiterCount).to.equal(3);

    // After 1s, holders 1 and 2 complete, freeing slots for 3 and 4
    await clock.tickAsync(1000);
    await p1;
    await p2;
    expect(results[1]).to.be.true;
    expect(results[2]).to.be.true;
    expect(results[3]).to.be.false;
    expect(results[4]).to.be.false;
    expect(results[5]).to.be.false;

    // Holder 3 unblocked when holder 1 disabled, holder 4 when holder 2 disabled
    // After another 1s, holders 3 and 4 complete, freeing slot for 5
    await clock.tickAsync(1000);
    await p3;
    await p4;
    expect(results[3]).to.be.true;
    expect(results[4]).to.be.true;
    expect(results[5]).to.be.false;

    // After another 1s, holder 5 completes
    await clock.tickAsync(1000);
    await p5;
    expect(results[5]).to.be.true;
  });

  it('should track waiterCount correctly with maxConcurrent', async () => {
    const asyncLock = new AsyncLock(2);

    // First two don't wait
    await asyncLock.enable();
    expect(asyncLock.waiterCount).to.equal(0);
    await asyncLock.enable();
    expect(asyncLock.waiterCount).to.equal(0);

    // Third and fourth will wait
    const p3 = asyncLock.enable();
    expect(asyncLock.waiterCount).to.equal(1);
    const p4 = asyncLock.enable();
    expect(asyncLock.waiterCount).to.equal(2);

    // Free slots
    asyncLock.disable();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(asyncLock.waiterCount).to.equal(1);

    asyncLock.disable();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(asyncLock.waiterCount).to.equal(0);

    await p3;
    await p4;

    // Cleanup
    asyncLock.disable();
    asyncLock.disable();
  });

  it('should add lock user without waiting when register() called', async () => {
    const asyncLock = new AsyncLock();

    asyncLock.register();
    expect(asyncLock.locked).to.be.true;

    // enable() on a mutex should block since register() took the slot
    let secondEnabled = false;
    const p = (async () => {
      await asyncLock.enable();
      secondEnabled = true;
    })();

    await new Promise((r) => { setTimeout(r, 0); });
    expect(secondEnabled).to.be.false;

    asyncLock.disable(); // free the register() slot
    await new Promise((r) => { setTimeout(r, 0); });
    expect(secondEnabled).to.be.true;

    asyncLock.disable(); // free the enable() slot
    await p;
  });

  it('should have register() occupy a semaphore slot', async () => {
    const asyncLock = new AsyncLock(2);

    // register() takes one slot, enable() takes the second
    asyncLock.register();
    await asyncLock.enable();

    // Third caller should block (both slots occupied)
    let thirdEnabled = false;
    const p = (async () => {
      await asyncLock.enable();
      thirdEnabled = true;
    })();

    await new Promise((r) => { setTimeout(r, 0); });
    expect(thirdEnabled).to.be.false;

    // Free the register() slot
    asyncLock.disable();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(thirdEnabled).to.be.true;

    // Cleanup
    asyncLock.disable();
    asyncLock.disable();
    await p;
  });

  it('should correctly propagate unblocking when holders finish out of order', async () => {
    const clock = sinon.useFakeTimers();
    const asyncLock = new AsyncLock(2);
    const results = [];

    // A is slow (5s), B is fast (1s). C and D are waiters.
    // disable() always shifts the front entry, so B finishing first
    // shifts A's entry and resolves A's promise, unblocking C.
    // When C finishes, it shifts B's entry, resolving B's promise, unblocking D.
    const holderA = async () => {
      await asyncLock.enable();
      await new Promise((r) => { setTimeout(r, 5000); });
      results.push('A');
      asyncLock.disable();
    };

    const holderB = async () => {
      await asyncLock.enable();
      await new Promise((r) => { setTimeout(r, 1000); });
      results.push('B');
      asyncLock.disable();
    };

    const holderC = async () => {
      await asyncLock.enable();
      await new Promise((r) => { setTimeout(r, 1000); });
      results.push('C');
      asyncLock.disable();
    };

    const holderD = async () => {
      await asyncLock.enable();
      await new Promise((r) => { setTimeout(r, 1000); });
      results.push('D');
      asyncLock.disable();
    };

    const pA = holderA();
    const pB = holderB();
    const pC = holderC();
    const pD = holderD();

    expect(asyncLock.waiterCount).to.equal(2);

    // t=1s: B finishes. disable() shifts A's entry, resolves A's promise.
    // C was waiting on A's promise -> C unblocks and starts running.
    await clock.tickAsync(1000);
    expect(results).to.deep.equal(['B']);

    // t=2s: C finishes. disable() shifts B's entry, resolves B's promise.
    // D was waiting on B's promise -> D unblocks and starts running.
    await clock.tickAsync(1000);
    expect(results).to.deep.equal(['B', 'C']);
    expect(asyncLock.waiterCount).to.equal(0);

    // t=3s: D finishes. A still running (2s left).
    await clock.tickAsync(1000);
    expect(results).to.deep.equal(['B', 'C', 'D']);

    // t=5s: A finally finishes.
    await clock.tickAsync(2000);
    expect(results).to.deep.equal(['B', 'C', 'D', 'A']);
    expect(asyncLock.locked).to.be.false;

    await Promise.all([pA, pB, pC, pD]);
  });
});
