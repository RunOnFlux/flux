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

  it('reissues the signal when the abort finishes, so the controller can be used again', async () => {
    // The signal is handed to work that has no loop - an http client built from
    // it, rebuilt straight after a stop - so it cannot stay aborted. That is
    // exactly why it cannot also carry whether the loop is wanted.
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

    expect(fc.aborted, 'a client rebuilt after a stop is born cancelled').to.be.false;
    expect(fc.state).to.equal('idle');
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

    expect(fc.running).to.be.false;
    expect(fc.state).to.equal('idle');
  });

  it('does not run a runner again after a stop, whatever locks it holds', async () => {
    // The iteration in flight is what undoes a stop: it ends by arming the next
    // one. Holding no lock is the case a stop cannot wait for, so it is the one
    // that has to be decided by the controller's own state.
    const clock = sinon.useFakeTimers();
    const fc = new FluxController();

    let runs = 0;
    const runner = async () => {
      runs += 1;
      await new Promise((r) => { setTimeout(r, 60); });
      return 40;
    };

    fc.startLoop(runner);
    await clock.tickAsync(20);
    const stopping = fc.abort();
    await clock.tickAsync(60);
    await stopping;
    const ranByTheStop = runs;

    await clock.tickAsync(10000);

    expect(runs, 'the loop outlived the stop and went on running').to.equal(ranByTheStop);
    clock.restore();
  });

  it('says a run is no longer wanted from the first line of a stop', async () => {
    const clock = sinon.useFakeTimers();
    const fc = new FluxController();

    expect(fc.active, 'a controller that has never run reported a live run').to.be.false;

    fc.startLoop(() => 1000);
    expect(fc.active).to.be.true;

    const holder = (async () => {
      await fc.lock.enable();
      await new Promise((r) => { setTimeout(r, 5000); });
      fc.lock.disable();
    })();

    const stopping = fc.abort();
    expect(fc.active, 'a run being stopped still reported itself wanted').to.be.false;
    expect(fc.running, 'a stop in progress reported itself stopped').to.be.true;

    await clock.tickAsync(5000);
    await holder;
    await stopping;

    expect(fc.active).to.be.false;
    expect(fc.running).to.be.false;
    clock.restore();
  });

  it('ends a runner that loops on its own, which the signal cannot do', async () => {
    // The case `active` exists for: a runner that yields and re-reads its
    // condition AFTER the stop has finished. The signal is reissued by then, so
    // a loop conditioned on it sees a controller that was never stopped and
    // runs for the life of the process.
    const clock = sinon.useFakeTimers();
    const fc = new FluxController();

    let iterations = 0;
    let sawSignalAfterStop = null;
    const runner = async () => {
      while (fc.active) {
        iterations += 1;
        // Holds no lock, so the stop has nothing to wait for and completes
        // while this is sleeping - the window the signal cannot cover.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => { setTimeout(r, 100); });
        sawSignalAfterStop = fc.aborted;
      }
      return 0;
    };

    fc.startLoop(runner);
    await clock.tickAsync(250);
    expect(iterations, 'the loop never ran').to.be.above(1);

    await fc.abort();
    const ranByTheStop = iterations;
    await clock.tickAsync(10000);

    expect(iterations, 'the loop outlived the stop').to.equal(ranByTheStop);
    expect(sawSignalAfterStop, 'the signal still read as aborted, so this proves nothing').to.be.false;
    clock.restore();
  });

  it('waits on a named lock that was added as a barrier', async () => {
    const clock = sinon.useFakeTimers();
    const fc = new FluxController();
    fc.addLock('teardown', { blocksAbort: true });

    let workDone = false;
    const work = (async () => {
      await fc.getLock('teardown').enable();
      await new Promise((r) => { setTimeout(r, 5000); });
      workDone = true;
      fc.getLock('teardown').disable();
    })();

    let doneWhenStopReturned = null;
    const stopping = fc.abort().then(() => { doneWhenStopReturned = workDone; });

    await clock.tickAsync(4000);
    expect(doneWhenStopReturned, 'the stop returned before its barrier work finished').to.be.null;

    await clock.tickAsync(1000);
    await work;
    await stopping;

    expect(doneWhenStopReturned, 'the stop did not wait for a lock declared as a barrier').to.be.true;
    clock.restore();
  });

  it('forgets a barrier when its lock is removed', async () => {
    const clock = sinon.useFakeTimers();
    const fc = new FluxController();
    fc.addLock('teardown', { blocksAbort: true });
    const lock = fc.getLock('teardown');
    fc.removeLock('teardown');

    let workDone = false;
    const work = (async () => {
      await lock.enable();
      await new Promise((r) => { setTimeout(r, 5000); });
      workDone = true;
      lock.disable();
    })();

    await fc.abort();

    expect(workDone, 'a removed lock still held up a stop').to.be.false;
    expect(fc.state).to.equal('idle');

    await clock.tickAsync(5000);
    await work;
    clock.restore();
  });

  it('waits on the default lock and leaves a named one to its owner', async () => {
    // The default lock is this controller's teardown barrier. A named lock
    // means whatever the caller made it mean - networkStateManager's `fetcher`
    // is how its readers wait for a fetch - and a stop that waited on those
    // would hang against a caller's own coordination.
    const clock = sinon.useFakeTimers();
    const fc = new FluxController();
    fc.addLock('fetcher');

    let named = false;
    const namedWork = (async () => {
      await fc.getLock('fetcher').enable();
      await new Promise((r) => { setTimeout(r, 5000); });
      named = true;
      fc.getLock('fetcher').disable();
    })();

    await fc.abort();
    expect(named, 'the stop waited for work it does not own').to.be.false;
    expect(fc.state, 'a stop held up by a named lock never finishes').to.equal('idle');

    await clock.tickAsync(5000);
    await namedWork;
    clock.restore();
  });

  it('refuses to start while a stop is still unwinding', async () => {
    const clock = sinon.useFakeTimers();
    const fc = new FluxController();

    const holder = (async () => {
      await fc.lock.enable();
      await new Promise((r) => { setTimeout(r, 5000); });
      fc.lock.disable();
    })();

    fc.startLoop(() => 1000);
    const stopping = fc.abort();

    expect(fc.state).to.equal('stopping');
    // Callers guard their own start on `running`. A stop in progress reading as
    // stopped is a caller that resets its state for a loop it never gets.
    expect(fc.running, 'a stop in progress reported itself stopped').to.be.true;
    expect(fc.startLoop(() => 1000), 'a second loop was started beside the one being stopped').to.be.false;

    await clock.tickAsync(5000);
    await holder;
    await stopping;

    expect(fc.startLoop(() => 1000), 'a stopped controller refused to start again').to.be.true;
    await fc.abort();
    clock.restore();
  });

  it('does not let an iteration from before a stop run beside the loop that replaced it', async () => {
    const clock = sinon.useFakeTimers();
    const fc = new FluxController();

    let release;
    let staleRuns = 0;
    let freshRuns = 0;
    const stale = async () => {
      staleRuns += 1;
      await new Promise((r) => { release = r; });
      return 10;
    };

    fc.startLoop(stale);
    await clock.tickAsync(0);
    // Holds no lock, so the stop has nothing to wait for and returns with the
    // iteration still in flight.
    await fc.abort();

    fc.startLoop(() => { freshRuns += 1; return 100; });
    release();
    await clock.tickAsync(1000);

    expect(staleRuns, 'the stale iteration armed a loop of its own beside the new one').to.equal(1);
    expect(freshRuns, 'the new loop did not run').to.be.above(1);

    await fc.abort();
    clock.restore();
  });

  it('lets a runner that throws reach the process, rather than losing the loop to it', async () => {
    // Every runner this serves guards the failures it expects, so a throw that
    // arrives here is one nobody predicted - and the node already has an answer
    // for those: apiServer's uncaughtException handler logs it and exits, and
    // systemd starts the node again with every subsystem back. Swallowed here
    // instead, the node stays up and this loop is stopped for the life of the
    // process, with nothing reading `running` and nothing to start it again.
    const fc = new FluxController();

    await expect(
      fc.loop(async () => { throw new Error('the runner gave up'); }),
      'the loop swallowed a fault the node restarts for',
    ).to.eventually.be.rejectedWith('the runner gave up');
  });
});
