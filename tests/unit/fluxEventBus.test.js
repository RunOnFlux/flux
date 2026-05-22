process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const fluxEventBus = require('../../ZelBack/src/services/utils/fluxEventBus');

const { FluxEventBus } = fluxEventBus;

describe('FluxEventBus tests', () => {
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

    it('should wrap ring buffer when full', () => {
      for (let i = 0; i < 1100; i++) {
        bus.publish('fill', { i });
      }
      const events = bus.since(0);
      expect(events).to.have.length(1024);
      expect(events[0].data.i).to.equal(76);
      expect(events[events.length - 1].data.i).to.equal(1099);
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
});
