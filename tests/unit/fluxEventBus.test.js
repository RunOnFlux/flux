process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const fluxEventBus = require('../../ZelBack/src/services/utils/fluxEventBus');

const { FluxEventBus } = fluxEventBus;

// Drives sseHandler as express would: a resuming consumer sending Last-Event-ID,
// and a close that clears the keepalive the handler starts.
function openStream(bus, lastEventId) {
  const written = [];
  let onClose = () => {};
  const req = {
    headers: { 'last-event-id': String(lastEventId) },
    on(event, cb) { if (event === 'close') onClose = cb; },
  };
  const res = {
    writeHead() {}, flushHeaders() {}, write(chunk) { written.push(chunk); },
  };
  bus.sseHandler(req, res);
  return { written, close: () => onClose() };
}

describe('FluxEventBus tests', () => {
  describe('event id continuity across a restart', () => {
    it('mints ids above anything the previous process served', () => {
      // A consumer filtering on last-seen-id (any SSE client sending
      // Last-Event-ID, and the integration harness's afterId) must not have its
      // whole post-restart stream discarded. A fresh bus stands in for the
      // process that replaces this one.
      const before = new FluxEventBus(true);
      before.publish('test:a', {});
      before.publish('test:b', {});
      const lastIdServed = before.since(0).pop().id;

      // Stand in for the seconds a real restart takes. Constructing the second
      // bus directly would assert that two constructions are more than a
      // microsecond apart, which is a property of the machine rather than of the
      // seeding. Waiting for the clock to pass the ids already served makes the
      // assertion below hold by construction; it costs a microsecond or two.
      let clockNow = Number(process.hrtime.bigint() / 1000n);
      while (clockNow <= lastIdServed) clockNow = Number(process.hrtime.bigint() / 1000n);

      const afterRestart = new FluxEventBus(true);
      afterRestart.publish('test:c', {});
      const firstIdAfter = afterRestart.since(0)[0].id;

      expect(
        firstIdAfter,
        'a restarted bus reused ids the previous process had already served - every post-restart event is invisible to a last-seen-id consumer',
      ).to.be.greaterThan(lastIdServed);
    });
  });

  describe('singleton (disabled by default config)', () => {
    it('should report disabled', () => {
      expect(fluxEventBus.enabled).to.equal(false);
    });

    it('should not emit events when publish is called', () => {
      let emitted = false;
      fluxEventBus.on('event', () => { emitted = true; });
      fluxEventBus.publish('test:event', { foo: 'bar' });
      expect(emitted).to.equal(false);
      fluxEventBus.removeAllListeners();
    });

    it('should return empty from since()', () => {
      fluxEventBus.publish('test:event', { foo: 'bar' });
      expect(fluxEventBus.since(0)).to.deep.equal([]);
    });

    it('should return 404 from sseHandler', () => {
      let statusCode = null;
      let jsonBody = null;
      const res = {
        status(code) { statusCode = code; return res; },
        json(body) { jsonBody = body; },
      };
      fluxEventBus.sseHandler({}, res);
      expect(statusCode).to.equal(404);
      expect(jsonBody.status).to.equal('error');
    });

    it('should not record counters', () => {
      fluxEventBus.count('masterSlave:cycles');
      fluxEventBus.count('masterSlave:decision', 'anApp', 'operatorStopped');
      expect(fluxEventBus.counters()).to.deep.equal({});
    });

    it('should return 404 from countersHandler', () => {
      let statusCode = null;
      let jsonBody = null;
      const res = {
        status(code) { statusCode = code; return res; },
        json(body) { jsonBody = body; },
      };
      fluxEventBus.countersHandler({}, res);
      expect(statusCode).to.equal(404);
      expect(jsonBody.status).to.equal('error');
    });
  });

  describe('enabled instance', () => {
    let bus;

    beforeEach(() => {
      bus = new FluxEventBus(true);
    });

    afterEach(() => {
      bus.removeAllListeners();
    });

    it('should report enabled', () => {
      expect(bus.enabled).to.equal(true);
    });

    it('should emit events via publish', () => {
      const received = [];
      bus.on('event', (entry) => received.push(entry));
      bus.publish('test:event', { value: 42 });
      expect(received).to.have.length(1);
      expect(received[0].event).to.equal('test:event');
      expect(received[0].data.value).to.equal(42);
      expect(received[0].id).to.be.a('number');
      expect(received[0].timestamp).to.be.a('number');
    });

    it('should assign monotonically increasing IDs', () => {
      const received = [];
      bus.on('event', (entry) => received.push(entry));
      bus.publish('a', {});
      bus.publish('b', {});
      bus.publish('c', {});
      expect(received[1].id).to.be.greaterThan(received[0].id);
      expect(received[2].id).to.be.greaterThan(received[1].id);
    });

    it('should return events from since() after given ID', () => {
      bus.publish('x', { n: 1 });
      bus.publish('y', { n: 2 });
      bus.publish('z', { n: 3 });
      const all = bus.since(0);
      expect(all).to.have.length(3);
      const lastTwo = bus.since(all[0].id);
      expect(lastTwo).to.have.length(2);
      expect(lastTwo[0].event).to.equal('y');
      expect(lastTwo[1].event).to.equal('z');
    });

    it('should return empty from since() when no events match', () => {
      bus.publish('a', {});
      const all = bus.since(0);
      const none = bus.since(all[0].id);
      expect(none).to.deep.equal([]);
    });

    it('should return every event when exactly at capacity', () => {
      // The ring is full but has overwritten nothing - the boundary where
      // since()'s wrapped/not-wrapped choice flips.
      for (let i = 0; i < 1024; i++) {
        bus.publish('fill', { i });
      }
      const events = bus.since(0);
      expect(events).to.have.length(1024);
      expect(events[0].data.i).to.equal(0);
      expect(events[events.length - 1].data.i).to.equal(1023);
    });

    it('should wrap ring buffer when full', () => {
      for (let i = 0; i < 1100; i++) {
        bus.publish('fill', { i });
      }
      const events = bus.since(0);
      expect(events).to.have.length(1024);
      expect(events[0].data.i).to.equal(76);
      expect(events[events.length - 1].data.i).to.equal(1099);
    });

    // Cadence, not facts - the rule at the top of fluxEventBus.js. These are the
    // properties a suite waiting on "the loop ran N more times" rests on.
    it('should count a bare name as a running total', () => {
      bus.count('masterSlave:cycles');
      bus.count('masterSlave:cycles');
      bus.count('masterSlave:cycles');
      expect(bus.counters()['masterSlave:cycles']).to.equal(3);
    });

    it('should count each path separately under one name', () => {
      bus.count('masterSlave:decision', 'appA', 'operatorStopped');
      bus.count('masterSlave:decision', 'appA', 'operatorStopped');
      bus.count('masterSlave:decision', 'appA', 'heldOnPeer');
      bus.count('masterSlave:decision', 'appB', 'operatorStopped');
      expect(bus.counters()['masterSlave:decision']).to.deep.equal({
        appA: { operatorStopped: 2, heldOnPeer: 1 },
        appB: { operatorStopped: 1 },
      });
    });

    it('should serve counters as data, not as Maps', () => {
      bus.count('masterSlave:decision', 'appA', 'started');
      let jsonBody = null;
      const res = { status() { return res; }, json(body) { jsonBody = body; } };
      bus.countersHandler({}, res);
      expect(jsonBody.status).to.equal('success');
      // JSON.stringify turns a Map into {}, so a counter that survives this
      // round trip is one a harness client can actually read.
      expect(JSON.parse(JSON.stringify(jsonBody.data))).to.deep.equal({
        'masterSlave:decision': { appA: { started: 1 } },
      });
    });

    // A consumer that fell behind the ring must be TOLD, or it waits out its
    // whole budget for an event that already came and went and reports the
    // timeout as a product bug.
    it('should report nothing dropped while the ring has never wrapped', () => {
      bus.publish('a', {});
      bus.publish('b', {});
      expect(bus.oldestRetainedId()).to.equal(0);
    });

    it('should report the oldest surviving id once the ring has wrapped', () => {
      for (let i = 0; i < 1100; i++) bus.publish('fill', { i });
      const survivors = bus.since(0);
      expect(bus.oldestRetainedId()).to.equal(survivors[0].id);
    });

    it('should announce the gap to a consumer that fell behind the ring', () => {
      bus.publish('first', {});
      const staleId = bus.since(0)[0].id;
      for (let i = 0; i < 1100; i++) bus.publish('fill', { i });

      const { written, close } = openStream(bus, staleId);
      close();
      const gap = written.find((c) => c.includes('event: stream:gap'));
      expect(gap, 'a consumer resuming into a wrapped ring was told nothing').to.be.a('string');
      const payload = JSON.parse(gap.match(/data: (.*)\n/)[1]);
      expect(payload.dropped).to.equal(bus.oldestRetainedId() - staleId - 1);
      expect(payload.dropped).to.be.greaterThan(0);
    });

    it('should not announce a gap to a consumer that is merely behind', () => {
      bus.publish('a', {});
      bus.publish('b', {});
      const lastId = bus.since(0)[0].id;

      const { written, close } = openStream(bus, lastId);
      close();
      expect(written.some((c) => c.includes('event: stream:gap'))).to.equal(false);
      expect(written.some((c) => c.includes('event: b'))).to.equal(true);
    });

    it('should not throw when a listener errors', () => {
      bus.on('event', () => { throw new Error('boom'); });
      expect(() => bus.publish('safe:event', {})).to.not.throw();
    });

    it('should still record event in buffer when listener errors', () => {
      bus.on('event', () => { throw new Error('boom'); });
      bus.publish('safe:event', { val: 1 });
      const events = bus.since(0);
      expect(events).to.have.length(1);
      expect(events[0].event).to.equal('safe:event');
    });
  });

  describe('checkpoints', () => {
    const { Checkpoint } = fluxEventBus;
    const POINT = Checkpoint.APPSYNC_BEFORE_BUDGET_SPENT;

    // Whether a promise has settled, after letting everything already queued run.
    const settled = async (promise) => {
      let done = false;
      promise.then(() => { done = true; });
      await new Promise((resolve) => { setImmediate(resolve); });
      return done;
    };

    const heldEvents = (bus) => bus.since(0).filter((e) => e.event === 'checkpoint:held').map((e) => e.data);

    it('passes straight through a held checkpoint when disabled', async () => {
      const bus = new FluxEventBus(false);
      bus.holdCheckpoint(POINT);

      expect(await settled(bus.checkpoint(POINT, 'app_app'))).to.equal(true);
    });

    it('says whether a caller would pause, and never when disabled', () => {
      const off = new FluxEventBus(false);
      off.holdCheckpoint(POINT);
      expect(off.isCheckpointHeld(POINT, 'app_app')).to.equal(false);

      const bus = new FluxEventBus(true);
      expect(bus.isCheckpointHeld(POINT, 'app_app')).to.equal(false);
      bus.holdCheckpoint(POINT, 'app_app');
      expect(bus.isCheckpointHeld(POINT, 'app_app')).to.equal(true);
      expect(bus.isCheckpointHeld(POINT, 'other_other')).to.equal(false);
      bus.releaseCheckpoint(POINT, 'app_app');
      expect(bus.isCheckpointHeld(POINT, 'app_app')).to.equal(false);
    });

    it('passes straight through a checkpoint nobody holds', async () => {
      const bus = new FluxEventBus(true);

      expect(await settled(bus.checkpoint(POINT, 'app_app'))).to.equal(true);
      expect(heldEvents(bus)).to.deep.equal([]);
    });

    it('pauses a caller at a held checkpoint, announces it, and resumes it on release', async () => {
      const bus = new FluxEventBus(true);
      bus.holdCheckpoint(POINT, 'app_app');

      const paused = bus.checkpoint(POINT, 'app_app');

      expect(await settled(paused)).to.equal(false);
      expect(heldEvents(bus)).to.deep.equal([{ name: POINT, key: 'app_app' }]);
      bus.releaseCheckpoint(POINT, 'app_app');
      expect(await settled(paused)).to.equal(true);
    });

    it('holds only the key it was asked to', async () => {
      const bus = new FluxEventBus(true);
      bus.holdCheckpoint(POINT, 'app_app');

      expect(await settled(bus.checkpoint(POINT, 'other_other'))).to.equal(true);
    });

    it('holds every key when no key is named, and releases them together', async () => {
      const bus = new FluxEventBus(true);
      bus.holdCheckpoint(POINT);

      const first = bus.checkpoint(POINT, 'a_a');
      const second = bus.checkpoint(POINT, 'b_b');

      expect(await settled(first)).to.equal(false);
      expect(await settled(second)).to.equal(false);
      bus.releaseCheckpoint(POINT);
      expect(await settled(first)).to.equal(true);
      expect(await settled(second)).to.equal(true);
    });

    it('keeps a caller paused while another hold still covers it', async () => {
      const bus = new FluxEventBus(true);
      bus.holdCheckpoint(POINT);
      bus.holdCheckpoint(POINT, 'app_app');

      const paused = bus.checkpoint(POINT, 'app_app');
      bus.releaseCheckpoint(POINT, 'app_app');

      expect(await settled(paused)).to.equal(false);
      bus.releaseAllCheckpoints();
      expect(await settled(paused)).to.equal(true);
    });

    it('refuses to hold a checkpoint no code path declares', () => {
      const bus = new FluxEventBus(true);

      expect(() => bus.holdCheckpoint('appSync:beforeBudgetSpnet')).to.throw(/No checkpoint named/);
    });

    describe('the control route', () => {
      const call = (bus, body) => {
        const res = {
          code: 200,
          status(code) { this.code = code; return this; },
          json(payload) { this.payload = payload; return this; },
        };
        bus.checkpointsHandler({ body }, res);
        return res;
      };

      it('is not served when disabled', () => {
        expect(call(new FluxEventBus(false), { name: POINT, action: 'hold' }).code).to.equal(404);
      });

      it('holds and releases, and reports what is paused', async () => {
        const bus = new FluxEventBus(true);

        expect(call(bus, { name: POINT, key: 'app_app', action: 'hold' }).code).to.equal(200);
        const paused = bus.checkpoint(POINT, 'app_app');
        await settled(paused);
        expect(call(bus, { action: 'releaseAll' }).payload.data.parked).to.deep.equal([]);
        expect(await settled(paused)).to.equal(true);
      });

      it('answers 400 for a name no code path declares, or an unknown action', () => {
        const bus = new FluxEventBus(true);

        expect(call(bus, { name: 'nope', action: 'hold' }).code).to.equal(400);
        expect(call(bus, { name: POINT, action: 'pause' }).code).to.equal(400);
      });
    });
  });
});
