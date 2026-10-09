const { expect } = require('chai');
const sinon = require('sinon');

const log = require('../../ZelBack/src/lib/log');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const systemdNotify = require('../../ZelBack/src/services/utils/systemdNotify');

describe('systemdNotify tests', () => {
  let runCommandStub;
  let infoStub;
  let warnStub;
  let errorStub;
  let notifySocket;
  let clock;

  const failed = { error: new Error('Failed to invoke barrier: Connection timed out'), stdout: '', stderr: '' };
  const sent = { error: null, stdout: '', stderr: '' };

  // A clock that each sleep and each attempt advance, so the retry window is
  // crossed without waiting for it.
  const fakeTime = () => {
    let t = 0;
    runCommandStub.callsFake(async () => {
      t += systemdNotify.ATTEMPT_TIMEOUT_MS;
      return runCommandStub.outcomes.shift() || failed;
    });
    return {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
        await new Promise(setImmediate);
      },
    };
  };

  beforeEach(() => {
    notifySocket = process.env.NOTIFY_SOCKET;
    process.env.NOTIFY_SOCKET = '/run/systemd/notify';
    runCommandStub = sinon.stub(serviceHelper, 'runCommand');
    runCommandStub.outcomes = [];
    infoStub = sinon.stub(log, 'info');
    warnStub = sinon.stub(log, 'warn');
    errorStub = sinon.stub(log, 'error');
    clock = fakeTime();
  });

  afterEach(() => {
    if (notifySocket === undefined) delete process.env.NOTIFY_SOCKET;
    else process.env.NOTIFY_SOCKET = notifySocket;
    sinon.restore();
  });

  it('sends nothing without a supervisor', async () => {
    delete process.env.NOTIFY_SOCKET;
    expect(await systemdNotify.notifyReady(clock)).to.equal(false);
    sinon.assert.notCalled(runCommandStub);
  });

  it('reports readiness through systemd-notify, bounded, logging only its own line', async () => {
    runCommandStub.outcomes.push(sent);
    expect(await systemdNotify.notifyReady(clock)).to.equal(true);
    sinon.assert.calledOnceWithExactly(runCommandStub, 'systemd-notify', {
      params: ['--ready'], logError: false, timeout: systemdNotify.ATTEMPT_TIMEOUT_MS,
    });
    sinon.assert.calledOnce(infoStub);
    sinon.assert.notCalled(warnStub);
    sinon.assert.notCalled(errorStub);
  });

  it('retries a failed attempt and warns once', async () => {
    runCommandStub.outcomes.push(failed, failed, sent);
    expect(await systemdNotify.notifyReady(clock)).to.equal(true);
    sinon.assert.callCount(runCommandStub, 3);
    sinon.assert.calledOnce(warnStub);
    sinon.assert.calledOnce(infoStub);
    sinon.assert.notCalled(errorStub);
  });

  it('gives up once the retry window has passed, with one error', async () => {
    const attemptAndDelay = systemdNotify.ATTEMPT_TIMEOUT_MS + systemdNotify.RETRY_DELAY_MS;
    expect(await systemdNotify.notifyReady(clock)).to.equal(false);
    expect(clock.now()).to.be.at.least(systemdNotify.RETRY_WINDOW_MS);
    expect(clock.now()).to.be.below(systemdNotify.RETRY_WINDOW_MS + attemptAndDelay);
    sinon.assert.calledOnce(warnStub);
    sinon.assert.calledOnce(errorStub);
    sinon.assert.notCalled(infoStub);
  });
});
