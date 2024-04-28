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
      await queue.empty;
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
      await queue.empty;
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

      await queue.empty;
    });

    it('should halt any further tasks if a task errors', async () => {
      const clock = sinon.useFakeTimers();
      const expectedRemaining = [3, 4, 5, 6, 7, 8, 9];

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
      // task gets added back to start of queue
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
      await queue.empty;
      // 7 for the first task, 1 normal attempt, 5 retries. Then another normal attempt
      // after the resume(), then 9 normal tasks = 16.
      expect(count).to.equal(16);
    });
  });
});
