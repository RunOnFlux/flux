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
      fakeStream.emit('data', Buffer.from(JSON.stringify(event)));
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

    it('should ignore clean exits (code 0)', async () => {
      emitDie('fluxwww_Osmosis', 0);
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.called).to.be.false;
      expect(logStub.warn.called).to.be.false;
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
      expect(logStub.info.calledWithMatch(/intentionally stopped/)).to.be.true;
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
      freshStream.emit('data', Buffer.from(JSON.stringify(event)));
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

    it('should detect crash loops and stop restarting', async () => {
      for (let i = 0; i < 3; i++) {
        emitDie('fluxwww_Osmosis', 1);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setImmediate(r));
      }

      expect(dockerServiceStub.appDockerStart.callCount).to.equal(3);

      emitDie('fluxwww_Osmosis', 1);
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.callCount).to.equal(3);
      expect(logStub.warn.calledWithMatch(/crash-looping/)).to.be.true;
    });

    it('should not apply crash loop of one container to another', async () => {
      for (let i = 0; i < 3; i++) {
        emitDie('fluxwww_Osmosis', 1);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setImmediate(r));
      }

      emitDie('fluxEthereumNodeLight_EthereumNodeLight', 1);
      await new Promise((r) => setImmediate(r));

      expect(dockerServiceStub.appDockerStart.callCount).to.equal(4);
    });

    it('should handle docker start failure gracefully', async () => {
      dockerServiceStub.appDockerStart.rejects(new Error('container gone'));

      emitDie('fluxwww_Osmosis', 1);
      await new Promise((r) => setImmediate(r));

      expect(logStub.error.calledWithMatch(/failed to restart/)).to.be.true;
    });
  });
});
