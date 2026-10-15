const { expect } = require('chai');
const {
  createDepartureQueue, queueDelayMs, QUEUE_BASE_MS, QUEUE_STEP_MS, MAX_TICKET_GAP_MS,
} = require('../../ZelBack/src/services/appLifecycle/departureQueue');

describe('departureQueue', () => {
  const LOCAL = '1.2.3.4:16127';
  const MINUTE = 60 * 1000;

  // index order is seniority: the last address is the newest instance
  function locations(...ips) {
    return ips.map((ip, index) => ({ ip, runningSince: new Date(1700000000000 + index) }));
  }
  const newestOfThree = locations('5.6.7.8:16127', '9.9.9.9:16127', LOCAL);

  describe('queueDelayMs', () => {
    it('puts the newest instance at the front of the queue', () => {
      expect(queueDelayMs(newestOfThree, LOCAL)).to.equal(QUEUE_BASE_MS);
    });

    it('puts the senior instance at the back', () => {
      expect(queueDelayMs(locations(LOCAL, '5.6.7.8:16127', '9.9.9.9:16127'), LOCAL))
        .to.equal(QUEUE_BASE_MS + 2 * QUEUE_STEP_MS);
    });

    it('makes an instance missing from the list wait longest, even in an empty list', () => {
      expect(queueDelayMs([], LOCAL)).to.equal(QUEUE_BASE_MS + QUEUE_STEP_MS);
    });
  });

  describe('mayDepart', () => {
    it('is READY once the app has been seen whole for the wait', () => {
      const queue = createDepartureQueue();

      expect(queue.mayDepart('a', newestOfThree, LOCAL, 3, 0).code).to.equal('AWAITING_TURN');
      expect(queue.mayDepart('a', newestOfThree, LOCAL, 3, QUEUE_BASE_MS).code).to.equal('READY');
    });

    it('answers BELOW_INSTANCE_COUNT and restarts the wait while the app is short', () => {
      const queue = createDepartureQueue();

      queue.mayDepart('a', newestOfThree, LOCAL, 3, 0);
      const short = queue.mayDepart('a', locations('5.6.7.8:16127', LOCAL), LOCAL, 3, QUEUE_BASE_MS - MINUTE);

      expect(short.code).to.equal('BELOW_INSTANCE_COUNT');
      expect(queue.mayDepart('a', newestOfThree, LOCAL, 3, QUEUE_BASE_MS + MINUTE).code).to.equal('AWAITING_TURN');
    });

    it('restarts the wait after a gap longer than MAX_TICKET_GAP_MS', () => {
      const queue = createDepartureQueue();

      queue.mayDepart('a', newestOfThree, LOCAL, 3, 0);

      expect(queue.mayDepart('a', newestOfThree, LOCAL, 3, MAX_TICKET_GAP_MS + 1).code).to.equal('AWAITING_TURN');
    });

    it('keeps one queue\'s observations apart from another\'s', () => {
      const first = createDepartureQueue();
      const second = createDepartureQueue();

      first.mayDepart('a', newestOfThree, LOCAL, 3, 0);

      expect(second.mayDepart('a', newestOfThree, LOCAL, 3, QUEUE_BASE_MS).code).to.equal('AWAITING_TURN');
      expect(first.mayDepart('a', newestOfThree, LOCAL, 3, QUEUE_BASE_MS).code).to.equal('READY');
    });
  });

  describe('forgetting', () => {
    it('forget starts that app\'s wait again', () => {
      const queue = createDepartureQueue();

      queue.mayDepart('a', newestOfThree, LOCAL, 3, 0);
      queue.forget('a');

      expect(queue.mayDepart('a', newestOfThree, LOCAL, 3, QUEUE_BASE_MS).code).to.equal('AWAITING_TURN');
    });

    it('retainOnly forgets the apps not named and keeps the ones that are', () => {
      const queue = createDepartureQueue();

      queue.mayDepart('kept', newestOfThree, LOCAL, 3, 0);
      queue.mayDepart('gone', newestOfThree, LOCAL, 3, 0);
      queue.retainOnly(new Set(['kept']));

      expect(queue.mayDepart('kept', newestOfThree, LOCAL, 3, QUEUE_BASE_MS).code).to.equal('READY');
      expect(queue.mayDepart('gone', newestOfThree, LOCAL, 3, QUEUE_BASE_MS).code).to.equal('AWAITING_TURN');
    });

    it('clear forgets every app', () => {
      const queue = createDepartureQueue();

      queue.mayDepart('a', newestOfThree, LOCAL, 3, 0);
      queue.clear();

      expect(queue.mayDepart('a', newestOfThree, LOCAL, 3, QUEUE_BASE_MS).code).to.equal('AWAITING_TURN');
    });
  });
});
