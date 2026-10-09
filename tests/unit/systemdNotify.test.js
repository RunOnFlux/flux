const { expect } = require('chai');
const sinon = require('sinon');

const log = require('../../ZelBack/src/lib/log');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const systemdNotify = require('../../ZelBack/src/services/utils/systemdNotify');

describe('systemdNotify tests', () => {
  let runCommandStub;
  let infoStub;
  let warnStub;
  let notifySocket;

  beforeEach(() => {
    notifySocket = process.env.NOTIFY_SOCKET;
    runCommandStub = sinon.stub(serviceHelper, 'runCommand');
    infoStub = sinon.stub(log, 'info');
    warnStub = sinon.stub(log, 'warn');
  });

  afterEach(() => {
    if (notifySocket === undefined) delete process.env.NOTIFY_SOCKET;
    else process.env.NOTIFY_SOCKET = notifySocket;
    sinon.restore();
  });

  it('sends nothing without a supervisor', async () => {
    delete process.env.NOTIFY_SOCKET;
    expect(await systemdNotify.notifyReady()).to.equal(false);
    sinon.assert.notCalled(runCommandStub);
  });

  it('sends READY through systemd-notify, bounded, logging only its own line', async () => {
    process.env.NOTIFY_SOCKET = '/run/systemd/notify';
    runCommandStub.resolves({ error: null, stdout: '', stderr: '' });
    expect(await systemdNotify.notifyReady()).to.equal(true);
    sinon.assert.calledOnceWithExactly(runCommandStub, 'systemd-notify', {
      params: ['--ready'], logError: false, timeout: systemdNotify.TIMEOUT_MS,
    });
    sinon.assert.calledOnce(infoStub);
    sinon.assert.notCalled(warnStub);
  });

  it('warns once when systemd-notify fails and does not throw', async () => {
    process.env.NOTIFY_SOCKET = '/run/systemd/notify';
    runCommandStub.resolves({ error: new Error('Failed to invoke barrier: Connection timed out'), stdout: '', stderr: '' });
    expect(await systemdNotify.notifyReady()).to.equal(false);
    sinon.assert.calledOnce(runCommandStub);
    sinon.assert.calledWithMatch(runCommandStub, 'systemd-notify', { logError: false });
    sinon.assert.calledOnce(warnStub);
    sinon.assert.notCalled(infoStub);
  });
});
