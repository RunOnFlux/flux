const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('events');
const proxyquire = require('proxyquire').noCallThru();

describe('containerCrashRecovery tests', () => {
  let crashRecovery;
  let dockerServiceStub;
  let globalStateStub;
  let appInspectorStub;
  let logStub;

  beforeEach(() => {
    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
    dockerServiceStub = {
      appDockerStart: sinon.stub().resolves('started'),
      dockerGetEvents: sinon.stub(),
    };
    globalStateStub = {
      bootContainerStateSettled: true,
      appsMonitored: {},
      stoppingContainers: new Set(),
    };
    appInspectorStub = { startAppMonitoring: sinon.stub() };

    crashRecovery = proxyquire('../../ZelBack/src/services/appMonitoring/containerCrashRecovery', {
      '../../lib/log': logStub,
      '../dockerService': dockerServiceStub,
      '../utils/globalState': globalStateStub,
      '../appManagement/appInspector': appInspectorStub,
    });
  });

  afterEach(() => {
    crashRecovery.stop();
    sinon.restore();
  });

  function makeDieEvent(name, exitCode) {
    return {
      Type: 'container',
      Action: 'die',
      Actor: { Attributes: { name, exitCode: String(exitCode) } },
    };
  }

  describe('start/stop', () => {
    it('should subscribe to docker die events', async () => {
      const fakeStream = new EventEmitter();
      fakeStream.destroy = sinon.stub();
      dockerServiceStub.dockerGetEvents.resolves(fakeStream);

      await crashRecovery.start();

      expect(dockerServiceStub.dockerGetEvents.calledOnce).to.be.true;
      const opts = dockerServiceStub.dockerGetEvents.firstCall.args[0];
      expect(opts.filters.type).to.deep.equal(['container']);
      expect(opts.filters.event).to.deep.equal(['die']);
    });

    it('should reconnect on stream error', async () => {
      const clock = sinon.useFakeTimers();
      const fakeStream = new EventEmitter();
      fakeStream.destroy = sinon.stub();
      dockerServiceStub.dockerGetEvents.resolves(fakeStream);

      await crashRecovery.start();
      fakeStream.emit('error', new Error('connection lost'));

      expect(logStub.error.calledWithMatch(/event stream error/)).to.be.true;

      const fakeStream2 = new EventEmitter();
      fakeStream2.destroy = sinon.stub();
      dockerServiceStub.dockerGetEvents.resolves(fakeStream2);

      clock.tick(10000);
      await Promise.resolve();

      expect(dockerServiceStub.dockerGetEvents.calledTwice).to.be.true;
      clock.restore();
    });

    it('should not reconnect after stop()', async () => {
      const clock = sinon.useFakeTimers();
      const fakeStream = new EventEmitter();
      fakeStream.destroy = sinon.stub();
      dockerServiceStub.dockerGetEvents.resolves(fakeStream);

      await crashRecovery.start();
      crashRecovery.stop();
      fakeStream.emit('error', new Error('connection lost'));

      clock.tick(15000);
      await Promise.resolve();

      expect(dockerServiceStub.dockerGetEvents.calledOnce).to.be.true;
      clock.restore();
    });

    it('should clear boot queue on stop()', async () => {
      globalStateStub.bootContainerStateSettled = false;
      globalStateStub.waitForBootContainerStateSettled = sinon.stub().returns(new Promise(() => {}));

      const fakeStream = new EventEmitter();
      fakeStream.destroy = sinon.stub();
      dockerServiceStub.dockerGetEvents.resolves(fakeStream);
      await crashRecovery.start();

      const event = makeDieEvent('fluxwww_Osmosis', 1);
      fakeStream.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      await new Promise((r) => setImmediate(r));
      expect(logStub.info.calledWithMatch(/during boot, queuing/)).to.be.true;

      crashRecovery.stop();

      globalStateStub.bootContainerStateSettled = true;
      await new Promise((r) => setImmediate(r));
      expect(dockerServiceStub.appDockerStart.called).to.be.false;
    });

    it('should not carry partial line buffer across reconnect', async () => {
      const clock = sinon.useFakeTimers({ shouldAdvanceTime: true });
      const fakeStream = new EventEmitter();
      fakeStream.destroy = sinon.stub();
      dockerServiceStub.dockerGetEvents.resolves(fakeStream);
      await crashRecovery.start();

      fakeStream.emit('data', Buffer.from('{"partial":"junk'));
      await clock.tickAsync(0);

      fakeStream.emit('error', new Error('disconnect'));

      const fakeStream2 = new EventEmitter();
      fakeStream2.destroy = sinon.stub();
      dockerServiceStub.dockerGetEvents.resolves(fakeStream2);
      await clock.tickAsync(10000);

      const event = makeDieEvent('fluxwww_Osmosis', 1);
      fakeStream2.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      await clock.tickAsync(0);

      expect(dockerServiceStub.appDockerStart.calledOnce).to.be.true;
      expect(dockerServiceStub.appDockerStart.firstCall.args[0]).to.equal('www_Osmosis');
      clock.restore();
    });
  });

  describe('event handling', () => {
    let fakeStream;

    beforeEach(async () => {
      fakeStream = new EventEmitter();
      fakeStream.destroy = sinon.stub();
      dockerServiceStub.dockerGetEvents.resolves(fakeStream);
      await crashRecovery.start();
    });

    function emitDie(name, exitCode) {
      const event = makeDieEvent(name, exitCode);
      fakeStream.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
    }

    it('should restart a crashed flux container', async () => {
      emitDie('fluxwww_Osmosis', 1);
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.calledOnce).to.be.true;
      expect(dockerServiceStub.appDockerStart.firstCall.args[0]).to.equal('www_Osmosis');
      expect(appInspectorStub.startAppMonitoring.calledOnce).to.be.true;
    });

    it('should restart a crashed zel container', async () => {
      emitDie('zelKadenaChainWebNode', 1);
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.calledOnce).to.be.true;
      expect(dockerServiceStub.appDockerStart.firstCall.args[0]).to.equal('KadenaChainWebNode');
    });

    it('should restart on a clean exit (code 0) by default (restart-always)', async () => {
      emitDie('fluxwww_Osmosis', 0);
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.calledOnce).to.be.true;
      expect(dockerServiceStub.appDockerStart.firstCall.args[0]).to.equal('www_Osmosis');
    });

    it('should ignore non-flux containers', async () => {
      emitDie('nginx_proxy', 1);
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.called).to.be.false;
    });

    it('should skip containers in the stoppingContainers set', async () => {
      globalStateStub.stoppingContainers.add('fluxwww_Osmosis');

      emitDie('fluxwww_Osmosis', 137);
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.called).to.be.false;
      expect(globalStateStub.stoppingContainers.has('fluxwww_Osmosis')).to.be.false;
    });

    it('should consume stoppingContainers even on clean exit', async () => {
      globalStateStub.stoppingContainers.add('fluxwww_Osmosis');

      emitDie('fluxwww_Osmosis', 0);
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.called).to.be.false;
      expect(globalStateStub.stoppingContainers.has('fluxwww_Osmosis')).to.be.false;
    });

    it('should queue events when boot not settled and drain after', async () => {
      // Need a fresh instance with boot not settled from the start
      crashRecovery.stop();
      globalStateStub.bootContainerStateSettled = false;
      let resolveBootSettled;
      globalStateStub.waitForBootContainerStateSettled = sinon.stub().returns(
        new Promise((resolve) => { resolveBootSettled = resolve; }),
      );

      const freshStream = new EventEmitter();
      freshStream.destroy = sinon.stub();
      dockerServiceStub.dockerGetEvents.resolves(freshStream);
      await crashRecovery.start();

      const event = makeDieEvent('fluxwww_Osmosis', 1);
      freshStream.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.called).to.be.false;
      expect(logStub.info.calledWithMatch(/during boot, queuing/)).to.be.true;

      globalStateStub.bootContainerStateSettled = true;
      resolveBootSettled();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.calledOnce).to.be.true;
      expect(dockerServiceStub.appDockerStart.firstCall.args[0]).to.equal('www_Osmosis');
    });

    it('should restart immediately on first crash', async () => {
      emitDie('fluxwww_Osmosis', 1);
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.calledOnce).to.be.true;
      expect(logStub.warn.calledWithMatch(/crashed.*restarting/)).to.be.true;
    });

    it('should apply backoff delay on second crash', async () => {
      const clock = sinon.useFakeTimers({ shouldAdvanceTime: true });

      emitDie('fluxwww_Osmosis', 1);
      await clock.tickAsync(0);
      expect(dockerServiceStub.appDockerStart.callCount).to.equal(1);

      dockerServiceStub.getDockerContainerOnly = sinon.stub().resolves({ State: 'exited' });
      emitDie('fluxwww_Osmosis', 1);
      await clock.tickAsync(0);
      expect(dockerServiceStub.appDockerStart.callCount).to.equal(1);
      expect(logStub.warn.calledWithMatch(/waiting 30s/)).to.be.true;

      await clock.tickAsync(30000);
      expect(dockerServiceStub.appDockerStart.callCount).to.equal(2);

      clock.restore();
    });

    it('should skip restart if container handled during backoff', async () => {
      const clock = sinon.useFakeTimers({ shouldAdvanceTime: true });

      emitDie('fluxwww_Osmosis', 1);
      await clock.tickAsync(0);

      dockerServiceStub.getDockerContainerOnly = sinon.stub().resolves({ State: 'running' });
      emitDie('fluxwww_Osmosis', 1);
      await clock.tickAsync(0);

      await clock.tickAsync(30000);
      expect(dockerServiceStub.appDockerStart.callCount).to.equal(1);
      expect(logStub.info.calledWithMatch(/already handled during backoff/)).to.be.true;

      clock.restore();
    });

    it('should reset backoff after container runs for 10+ minutes', async () => {
      const clock = sinon.useFakeTimers({ shouldAdvanceTime: true });

      // First crash — immediate
      emitDie('fluxwww_Osmosis', 1);
      await clock.tickAsync(0);
      expect(dockerServiceStub.appDockerStart.callCount).to.equal(1);

      // Second crash — 30s backoff
      dockerServiceStub.getDockerContainerOnly = sinon.stub().resolves({ State: 'exited' });
      emitDie('fluxwww_Osmosis', 1);
      await clock.tickAsync(30000);
      expect(dockerServiceStub.appDockerStart.callCount).to.equal(2);

      // Container runs successfully for 10+ minutes, then crashes again
      await clock.tickAsync(11 * 60 * 1000);
      emitDie('fluxwww_Osmosis', 1);
      await clock.tickAsync(0);

      // Should be immediate again (backoff reset), not 5m
      expect(dockerServiceStub.appDockerStart.callCount).to.equal(3);
      expect(logStub.warn.calledWithMatch(/waiting 5/)).to.be.false;

      clock.restore();
    });

    it('should pin backoff at the 30m cap and not escalate beyond it', async () => {
      const clock = sinon.useFakeTimers({ shouldAdvanceTime: true });
      dockerServiceStub.getDockerContainerOnly = sinon.stub().resolves({ State: 'exited' });

      // first crash restarts immediately
      emitDie('fluxwww_Osmosis', 1);
      await clock.tickAsync(0);
      expect(dockerServiceStub.appDockerStart.callCount).to.equal(1);

      // ladder escalates: 30s, 5m, 15m, 30m
      const ladder = [30 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
      let expectedCount = 1;
      // eslint-disable-next-line no-restricted-syntax
      for (const delay of ladder) {
        emitDie('fluxwww_Osmosis', 1);
        // eslint-disable-next-line no-await-in-loop
        await clock.tickAsync(delay);
        expectedCount += 1;
        expect(dockerServiceStub.appDockerStart.callCount).to.equal(expectedCount);
      }

      // further crashes stay pinned at the 30m cap (history bounded, ladder index pinned)
      emitDie('fluxwww_Osmosis', 1);
      await clock.tickAsync(30 * 60 * 1000);
      expect(dockerServiceStub.appDockerStart.callCount).to.equal(expectedCount + 1);
      expect(logStub.warn.calledWithMatch(/waiting 1800s/)).to.be.true;

      clock.restore();
    });

    it('should not apply backoff of one container to another', async () => {
      emitDie('fluxwww_Osmosis', 1);
      await new Promise((r) => setImmediate(r));

      emitDie('fluxEthereumNodeLight_EthereumNodeLight', 1);
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.callCount).to.equal(2);
    });

    it('should handle docker start failure gracefully', async () => {
      dockerServiceStub.appDockerStart.rejects(new Error('container gone'));

      emitDie('fluxwww_Osmosis', 1);
      await new Promise((r) => setImmediate(r));

      expect(logStub.error.calledWithMatch(/failed to restart/)).to.be.true;
    });

    it('should handle two events in one chunk', async () => {
      const event1 = makeDieEvent('fluxwww_Osmosis', 1);
      const event2 = makeDieEvent('fluxkaspad_foo', 1);
      fakeStream.emit('data', Buffer.from(JSON.stringify(event1) + '\n' + JSON.stringify(event2) + '\n'));
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.callCount).to.equal(2);
      expect(dockerServiceStub.appDockerStart.firstCall.args[0]).to.equal('www_Osmosis');
      expect(dockerServiceStub.appDockerStart.secondCall.args[0]).to.equal('kaspad_foo');
    });

    it('should handle an event split across two chunks', async () => {
      const json = JSON.stringify(makeDieEvent('fluxwww_Osmosis', 1)) + '\n';
      const mid = Math.floor(json.length / 2);
      fakeStream.emit('data', Buffer.from(json.slice(0, mid)));
      await new Promise((r) => setImmediate(r));
      expect(dockerServiceStub.appDockerStart.called).to.be.false;

      fakeStream.emit('data', Buffer.from(json.slice(mid)));
      await new Promise((r) => setImmediate(r));
      expect(dockerServiceStub.appDockerStart.calledOnce).to.be.true;
    });
  });
});
