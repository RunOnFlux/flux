const chai = require('chai');
chai.use(require('chai-as-promised'));

const { expect } = chai;

const sinon = require('sinon');

const { FluxController } = require('../../ZelBack/src/services/utils/fluxController');

describe('fluxController tests', () => {
  beforeEach(async () => { });

  afterEach(() => {
    sinon.restore();
  });

  it('should instantiate and not be aborted or locked', () => {
    const fc = new FluxController();

    expect(fc.locked).to.be.false;
    expect(fc.aborted).to.be.false;
  });

  it('should interrupt any sleeps that are being awaited if abort called', async () => {
    const clock = sinon.useFakeTimers();
    let testVar = false;

    const fc = new FluxController();

    const tester = async () => {
      await fc.sleep(5000);
      testVar = true;
    };

    const promise = tester();

    await clock.tickAsync(3000);
    expect(testVar).to.be.false;
    await fc.abort();
    expect(testVar).to.be.false;
    await expect(promise).to.be.rejectedWith(Error);
    expect(testVar).to.be.false;
  });

  it('should wait for any actions to be completed when aborted', async () => {
    const clock = sinon.useFakeTimers();
    let dummyVar = false;
    let waiterVar = false;

    const fc = new FluxController();

    const dummy = async () => {
      await fc.lock.enable();
      await new Promise((r) => { setTimeout(r, 5000); });
      dummyVar = true;
      fc.lock.disable();
    };

    const waiter = async () => {
      await fc.abort();
      waiterVar = true;
    };

    const testPromise = dummy();
    expect(dummyVar).to.be.false;
    expect(fc.locked).to.be.true;

    await clock.tickAsync(3000);
    expect(dummyVar).to.be.false;
    expect(fc.locked).to.be.true;

    const abortPromise = waiter();

    // test function still sleeping
    // waiter still waiting on abort
    await clock.tickAsync(1000);
    expect(dummyVar).to.be.false;
    expect(fc.locked).to.be.true;
    expect(waiterVar).to.be.false;

    // both test function and waiter have resolved
    await clock.tickAsync(1000);
    expect(dummyVar).to.be.true;
    expect(fc.locked).to.be.false;
    expect(waiterVar).to.be.true;

    // these should both resolve immediately
    await abortPromise;
    await testPromise;

    expect(dummyVar).to.be.true;
    expect(fc.locked).to.be.false;
    expect(waiterVar).to.be.true;
  });

  it('should reset the abort controller on abort', async () => {
    const fc = new FluxController();

    const tester = async () => {
      try {
        await fc.sleep(5000);
      } catch {
        expect(fc.aborted).to.be.true;
      }
    };

    const promise = tester();

    expect(fc.aborted).to.be.false;
    await fc.abort();
    await promise;
    expect(fc.aborted).to.be.false;
  });

  it('should start a loop when runner passed in', async () => {
    const clock = sinon.useFakeTimers();

    const fc = new FluxController();

    let interations = 0;

    const runner = () => {
      interations += 1;
      return 100;
    };

    const started = fc.startLoop(runner);

    expect(started).to.be.true;
    expect(fc.running).to.be.true;
    expect(interations).to.equal(1);

    await clock.tickAsync(10);
    expect(interations).to.equal(1);
    await clock.tickAsync(100);
    expect(interations).to.equal(2);
    // tidy up
    fc.abort();
  });

  it('should stop a running loop when abort called', async () => {
    const clock = sinon.useFakeTimers();

    const fc = new FluxController();

    const runner = () => 100;

    fc.startLoop(runner);

    expect(fc.running).to.be.true;

    // run some iterations
    await clock.tickAsync(1000);

    await fc.abort();

    // Verify the loop has stopped and state is reset
    expect(fc.running).to.be.false;
    expect(fc.aborted).to.be.false; // Should be reset after abort completes
  });
});
