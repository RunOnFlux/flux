const chai = require('chai');
const sinon = require('sinon');
const EventEmitter = require('node:events');

const { expect } = chai;

const fifoQueue = require('../../ZelBack/src/services/utils/fifoQueue');

describe('FiFoQueue tests', () => {
  describe('FiFoQueue initialization tests', () => {
    it('should instantiate with defaults, and be an instance of EventEmitter', async () => {
      const queue = new fifoQueue.FifoQueue();

      expect(queue instanceof EventEmitter === true).to.equal(true);
      expect(queue.workAvailable).to.equal(false);
      expect(queue.working).to.equal(false);
      expect(queue.halted).to.equal(false);
      expect(queue.queueFull).to.equal(false);
      // defaults
      expect(queue.retries).to.equal(5);
      expect(queue.retryDelay).to.equal(60000);
      expect(queue.maxSize).to.equal(10);
    });
    it('should add the worker if defined at instantiation', () => {
      const worker = () => { };

      const queue = new fifoQueue.FifoQueue({ worker });
      expect(queue.worker).to.equal(worker);
    });
    it('should add the worker if added via addWorker', () => {
      const worker = () => { };

      const queue = new fifoQueue.FifoQueue();
      queue.addWorker(worker);

      expect(queue.worker).to.equal(worker);
    });
    it('should refuse a second worker rather than silently keeping the first', () => {
      const worker = () => { };
      const other = () => { };

      const queue = new fifoQueue.FifoQueue({ worker });

      expect(() => queue.addWorker(other)).to.throw('FifoQueue already has a worker');
      expect(queue.worker).to.equal(worker);
    });
    it('should not start work if work is avaiable but no worker present', () => {
      const queue = new fifoQueue.FifoQueue();
      queue.push('hi there');

      expect(queue.workAvailable).to.equal(true);
      expect(queue.working).to.equal(false);
      expect(queue.list.length).to.equal(1);
      expect(queue.halted).to.equal(false);
    });
  });

  describe('FifoQueue work tests', () => {
    beforeEach(() => {

    });
    afterEach(() => {
      sinon.restore();
    });

    it('should start work if worker present and task added to queue', async () => {
      let called = 0;
      const worker = async () => { called += 1; };
      const queue = new fifoQueue.FifoQueue({ worker });

      const promise = queue.push('hi there');
      expect(queue.working).to.equal(true);
      await promise;
      expect(queue.working).to.equal(false);
      expect(called).to.equal(1);
    });

    it('should await work if worker present and task added to queue', async () => {
      const clock = sinon.useFakeTimers();

      let called = 0;
      const wait = true;

      const worker = async () => {
        await new Promise((r) => { setTimeout(r, 1000); });
        called += 1;
        return 42;
      };

      const queue = new fifoQueue.FifoQueue({ worker });

      const promise = queue.push('hi there', wait);
      expect(queue.working).to.equal(true);
      expect(called).to.equal(0);

      await clock.tickAsync(1000);

      const res = await promise;
      expect(queue.working).to.equal(false);
      expect(called).to.equal(1);
      expect(res).to.equal(42);
    });

    it('should retry task if task has an error', async () => {
      const clock = sinon.useFakeTimers();

      let called = 0;
      let error = 0;

      const worker = async () => {
        if (!called) {
          called += 1;
          throw new Error('Simulated task error');
        }
        called += 1;
        return 42;
      };

      const queue = new fifoQueue.FifoQueue({ retries: 1, worker });

      queue.on('failed', () => { error += 1; });

      queue.push(['lets work!']);
      expect(called).to.equal(1);

      await clock.tickAsync(60 * 1000);

      expect(called).to.equal(2);
      expect(error).to.equal(0);
      expect(queue.working).to.equal(false);
      await queue.finished;
    });

    it('should drop a failed task the caller asked not to retain', async () => {
      // Retained, the failed task sits at the head of the queue and runs again the
      // instant anything resumes it - which the apt cache monitor does on every
      // failure. With retries at 0 there is no delay between those attempts, so the
      // pair of them spin flat out.
      const worker = async () => { throw new Error('Simulated task error'); };

      const queue = new fifoQueue.FifoQueue({ worker });

      queue.push({ commandOptions: { command: 'update' }, workerOptions: { retries: 0, retainErrors: false } });
      await queue.finished;

      expect(queue.length).to.equal(0);
    });

    it('should name the failed command in the event, not the payload wrapping it', async () => {
      // A listener asks what failed. For the {commandOptions, workerOptions} shape
      // the command is a level down, so emitting the payload put it out of reach and
      // every test against it matched nothing at all.
      let seen = null;
      const worker = async () => { throw new Error('Simulated task error'); };

      const queue = new fifoQueue.FifoQueue({ worker });
      queue.on('failed', (event) => { seen = event.options.command; });

      queue.push({ commandOptions: { command: 'update' }, workerOptions: { retries: 0 } });
      await queue.finished;

      expect(seen).to.equal('update');
    });

    it('should put a failed task behind the others so it cannot block them', async () => {
      // At the front, a task that can never succeed is handed straight back to the
      // worker on every resume and nothing queued behind it ever runs - one package
      // apt cannot find stops a node installing any of the others.
      const ran = [];
      const worker = async (opts) => {
        ran.push(opts.command);
        if (opts.command === 'bad') throw new Error('Simulated task error');
      };

      const queue = new fifoQueue.FifoQueue({ worker, retryDelay: 0 });
      // the apt cache monitor resumes on failure, and it is async - so its resume
      // lands after work() has exited, which is what restarts the queue at all.
      // It awaits real commands, so the wait here is a macrotask too: awaiting a
      // microtask instead starves the event loop and this test hangs rather than
      // failing when the behaviour regresses.
      queue.on('failed', async () => {
        await new Promise((r) => { setTimeout(r, 0); });
        queue.resume();
      });

      queue.push({ commandOptions: { command: 'bad' }, workerOptions: { retries: 0 } });
      queue.push({ commandOptions: { command: 'good' }, workerOptions: { retries: 0 } });

      await new Promise((r) => { setTimeout(r, 50); });

      expect(ran).to.include('good');
    });

    // The apt cache monitor resumes SYNCHRONOUSLY for a failed apt-get update:
    // `if (options.command === 'update') { getQueue().resume(); return; }`, with no
    // await before it, so its resume lands inside the emit. A halt written after
    // the emit silently undid it - the loop broke out with work still queued and
    // nothing ever restarted it, because push() only calls work() when the queue
    // is not already working and working goes false on the way out. One failed
    // update at boot stranded every apt task behind it for the life of the
    // process, so syncthing and chrony never installed.
    it('should keep draining when a listener resumes synchronously from the emit', async () => {
      const ran = [];
      const worker = async (opts) => {
        ran.push(opts.command);
        if (opts.command === 'update') throw new Error('Could not resolve mirror');
      };

      const queue = new fifoQueue.FifoQueue({ worker, retryDelay: 0 });
      queue.on('failed', ({ options }) => {
        if (options.command === 'update') queue.resume();
      });

      queue.push({ commandOptions: { command: 'update' }, workerOptions: { retries: 0 } });
      queue.push({ commandOptions: { command: 'install' }, workerOptions: { retries: 0 } });

      await new Promise((r) => { setTimeout(r, 50); });

      expect(ran, 'the update must actually have failed, or the rest proves nothing').to.include('update');
      expect(ran, 'the task queued behind a failed update must still run').to.include('install');
      expect(queue.halted, 'a resumed queue must not be left halted').to.equal(false);
    });

    // The other half, and the one an operator meets later: push() on a halted queue
    // appends the task and starts a work loop that exits on its first check.
    // Nothing reports it - the caller's `wait: true` promise simply never settles.
    it('should run work pushed after a synchronously-resumed failure', async () => {
      const ran = [];
      const worker = async (opts) => {
        ran.push(opts.command);
        if (opts.command === 'update') throw new Error('Could not resolve mirror');
      };

      const queue = new fifoQueue.FifoQueue({ worker, retryDelay: 0 });
      queue.on('failed', ({ options }) => {
        if (options.command === 'update') queue.resume();
      });

      queue.push({ commandOptions: { command: 'update' }, workerOptions: { retries: 0 } });
      await new Promise((r) => { setTimeout(r, 20); });

      queue.push({ commandOptions: { command: 'install-later' }, workerOptions: { retries: 0 } });
      await new Promise((r) => { setTimeout(r, 20); });

      expect(ran, 'work pushed after the failure must still run').to.include('install-later');
    });

    // A resumed final failure has no retries left, so falling through to the retry
    // sleep waits out the full delay - the production default is 60s - with nothing
    // to retry, holding every task behind it. retryDelay is deliberately large here
    // and the assertion window small: with the ladder-over break the next task runs
    // immediately, without it the queue is inside a 5s sleep and has not reached it.
    it('should not sleep out the retry delay after a resumed final failure', async () => {
      const ran = [];
      const worker = async (opts) => {
        ran.push(opts.command);
        if (opts.command === 'update') throw new Error('Could not resolve mirror');
      };

      const queue = new fifoQueue.FifoQueue({ worker, retryDelay: 5000 });
      queue.on('failed', ({ options }) => {
        if (options.command === 'update') queue.resume();
      });

      queue.push({ commandOptions: { command: 'update' }, workerOptions: { retries: 0 } });
      queue.push({ commandOptions: { command: 'install' }, workerOptions: { retries: 0 } });

      await new Promise((r) => { setTimeout(r, 50); });

      expect(ran, 'the update must have failed first').to.include('update');
      expect(ran, 'the queue must carry on rather than sleep out a delay it has no retries for').to.include('install');
    });

    // resume() from inside the loop used to overwrite `finished` with work()'s
    // already-resolved promise, so clear() - which awaits it to know the queue is
    // idle, and which systemService calls on the apt-is-broken path these very
    // failures reach - could wipe the list while a worker was still in flight.
    it('should not report itself idle to clear() while a worker is still running', async () => {
      let releaseWorker;
      const held = new Promise((r) => { releaseWorker = r; });
      let secondEntered = false;

      const worker = async (opts) => {
        if (opts.command === 'update') throw new Error('Could not resolve mirror');
        secondEntered = true;
        await held; // still in flight while clear() runs
      };

      const queue = new fifoQueue.FifoQueue({ worker, retryDelay: 0 });
      queue.on('failed', ({ options }) => {
        if (options.command === 'update') queue.resume();
      });

      queue.push({ commandOptions: { command: 'update' }, workerOptions: { retries: 0 } });
      queue.push({ commandOptions: { command: 'slow' }, workerOptions: { retries: 0 } });
      await new Promise((r) => { setTimeout(r, 20); });

      expect(secondEntered, 'the second task must be in flight, or this tests nothing').to.equal(true);

      // clear() awaits `finished` to know the queue is idle before wiping the list.
      // A re-entrant resume that replaced `finished` with work()'s already-resolved
      // promise makes that await return at once, so clear() empties the queue under
      // a running worker - and systemService calls clear() on the apt-is-broken
      // path these very failures reach.
      const cleared = queue.clear().then(() => 'cleared');
      const outcome = await Promise.race([
        cleared,
        new Promise((r) => { setTimeout(() => r('still-working'), 30); }),
      ]);

      expect(outcome, 'clear() must not report the queue idle while a worker is in flight').to.equal('still-working');

      releaseWorker();
      await cleared;
    });

    it('should give up on a task that keeps failing, and say so', async () => {
      // Each resume grants a fresh ladder of retries, so retain-and-resume is
      // unbounded without a ceiling: the ladder ends, something resumes, it starts
      // again, once a minute for the life of the process.
      let abandoned = null;
      const worker = async () => { throw new Error('Simulated task error'); };

      const queue = new fifoQueue.FifoQueue({ worker, retryDelay: 0, maxRetainCycles: 2 });
      queue.on('failed', async () => {
        await new Promise((r) => { setTimeout(r, 0); });
        queue.resume();
      });
      queue.on('abandoned', (event) => { abandoned = event; });

      queue.push({ commandOptions: { command: 'bad' }, workerOptions: { retries: 0 } });

      await new Promise((r) => { setTimeout(r, 50); });

      expect(abandoned).to.not.equal(null);
      expect(abandoned.options.command).to.equal('bad');
      expect(abandoned.cycles).to.equal(3);
      expect(queue.length).to.equal(0);
    });

    it('should emit error if task is unrecoverable', async () => {
      const clock = sinon.useFakeTimers();

      let error = 0;

      const worker = async () => {
        throw new Error('Simulated task error');
      };

      const queue = new fifoQueue.FifoQueue({ retries: 2, retryDelay: 500, worker });

      queue.on('failed', () => { error += 1; });

      queue.push(['lets work!']);

      // 500ms per retry
      await clock.tickAsync(1000);

      expect(error).to.equal(1);
      await queue.finished;
    });

    it('should discard task if retainErrors is false on task', async () => {
      const clock = sinon.useFakeTimers();

      let error = 0;

      const worker = async () => {
        throw new Error('Simulated task error');
      };

      const queue = new fifoQueue.FifoQueue({ retries: 4, retryDelay: 500, worker });

      queue.on('failed', () => { error += 1; });

      queue.push({ commandOptions: ['lets work'], workerOptions: { retainErrors: false } });

      // 500ms per retry
      await clock.tickAsync(2000);

      expect(error).to.equal(1);
      await queue.finished;
      expect(queue.workAvailable).to.equal(false);
    });

    it('should run tasks synchronously', async () => {
      const clock = sinon.useFakeTimers();
      const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

      let count = 0;

      const wait = true;

      const worker = async (input) => {
        await new Promise((r) => { setTimeout(r, 1000); });
        count += 1;
        return input;
      };

      const queue = new fifoQueue.FifoQueue({ worker });

      const tasks = [];
      for (let i = 0; i < 5; i += 1) {
        tasks.push(queue.push(i, wait));
      }

      // only 2 tasks would have run at this point
      await clock.tickAsync(2 * 1000);
      expect(count).to.equal(2);

      for (let i = 5; i < 10; i += 1) {
        tasks.push(queue.push(i, wait));
      }

      // run out the clock on the tasks
      await clock.tickAsync(8 * 1000);

      const results = await Promise.all(tasks);

      expect(count).to.equal(10);
      expect(results).to.deep.equal(expected);

      await queue.finished;
    });

    it('should halt any further tasks if a task errors', async () => {
      const clock = sinon.useFakeTimers();
      // The failed task goes to the BACK. At the front it is handed straight back
      // to the worker on the next resume, ahead of everything else, so a task that
      // cannot succeed is retried forever and nothing behind it ever runs.
      const expectedRemaining = [4, 5, 6, 7, 8, 9, 3];

      let count = 0;
      let error = 0;

      const wait = true;

      const worker = async (input) => {
        await new Promise((r) => { setTimeout(r, 1000); });
        if (count === 3) throw new Error('Simulated task error');

        count += 1;

        return input;
      };

      const queue = new fifoQueue.FifoQueue({ worker });
      queue.on('failed', () => { error += 1; });

      const tasks = [];
      for (let i = 0; i < 10; i += 1) {
        tasks.push(queue.push(i, wait));
      }

      // let the first 3 tasks run successfully
      await clock.tickAsync(3 * 1000);
      expect(count).to.equal(3);

      // allow 5 retries for faulty task (and 6000ms for tasks)
      await clock.tickAsync(5 * 60000 + 6000);
      expect(error).to.equal(1);

      // allow enough time that the tasks could run if the queue wasn't halted
      await clock.tickAsync(7 * 1000);

      expect(queue.halted).to.equal(true);
      expect(queue.workAvailable).to.equal(true);
      expect(queue.length).to.equal(7);

      expect(count).to.equal(3);
      expect(queue.list).to.deep.equal(expectedRemaining);
    });

    it('should resume tasks if there was a previous error', async () => {
      const clock = sinon.useFakeTimers();

      let count = 0;
      let error = 0;

      const wait = true;

      const worker = async (input) => {
        count += 1;
        // the 6 is the retries + the initial
        // so if it's the first item in the queue
        if (!input && count <= 6) throw new Error('Simulated task error');

        return input;
      };

      const queue = new fifoQueue.FifoQueue({ worker });
      queue.on('failed', () => { error += 1; });

      const tasks = [];
      for (let i = 0; i < 10; i += 1) {
        tasks.push(queue.push(i, wait));
      }

      // run out the retry clock
      await clock.tickAsync(300 * 1000);

      expect(error).to.equal(1);
      expect(queue.halted).to.equal(true);

      // run out the clock some more, if tasks were still running,
      // they would have finished a long time ago
      await clock.tickAsync(50 * 1000);
      expect(queue.halted).to.equal(true);
      queue.resume();
      await queue.finished;
      // 7 for the first task, 1 normal attempt, 5 retries. Then another normal attempt
      // after the resume(), then 9 normal tasks = 16.
      expect(count).to.equal(16);
    });

    it('should resolve any awaited tasks with Error if queue cleared', async () => {
      const clock = sinon.useFakeTimers();

      let workDone = 0;
      let workAwaited = 0;
      const workResults = [];

      const expectedresults = [
        { error: null, data: 0 },
        { error: null, data: 1 },
        { error: null, data: 2 },
        { error: null, data: 3 },
        { error: null, data: 4 },
        { error: null, data: 5 },
        { error: new Error('Queue cleared') },
        { error: new Error('Queue cleared') },
        { error: new Error('Queue cleared') },
        { error: new Error('Queue cleared') },
      ];

      const worker = async (item) => {
        await new Promise((r) => { setTimeout(r, 5_000); });
        workDone += 1;
        return { error: null, data: item };
      };

      const queue = new fifoQueue.FifoQueue({ worker });

      const waitForQueue = async (item) => {
        const res = await queue.push(item, true);
        workResults.push(res);
        workAwaited += 1;
      };

      // this will take 50 seconds for the queue to clear
      // under normal circumstances
      for (let i = 0; i < 10; i += 1) {
        waitForQueue(i);
      }

      setTimeout(() => queue.clear(), 30_000);

      expect(workDone).to.equal(0);
      expect(workAwaited).to.equal(0);

      await clock.tickAsync(10_000);
      expect(workDone).to.equal(2);
      expect(workAwaited).to.equal(2);

      await clock.tickAsync(10_000);
      expect(workDone).to.equal(4);
      expect(workAwaited).to.equal(4);

      // queue cleared here
      await clock.tickAsync(10_000);

      // the worker doesn't run for the cleared tasks
      expect(workDone).to.equal(6);
      expect(workAwaited).to.equal(10);
      expect(workResults).to.deep.equal(expectedresults);
      expect(queue.workAvailable).to.equal(false);
    });
  });
});
