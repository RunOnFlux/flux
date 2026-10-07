const { expect } = require('chai');
const sinon = require('sinon');
const childProcess = require('node:child_process');

const log = require('../../ZelBack/src/lib/log');
const systemdNotify = require('../../ZelBack/src/services/utils/systemdNotify');

describe('systemdNotify tests', () => {
  let execFileStub;
  let infoStub;
  let warnStub;
  let savedSocket;

  beforeEach(() => {
    savedSocket = process.env.NOTIFY_SOCKET;
    execFileStub = sinon.stub(childProcess, 'execFile');
    infoStub = sinon.stub(log, 'info');
    warnStub = sinon.stub(log, 'warn');
  });

  afterEach(() => {
    if (savedSocket === undefined) {
      delete process.env.NOTIFY_SOCKET;
    } else {
      process.env.NOTIFY_SOCKET = savedSocket;
    }
    sinon.restore();
  });

  it('sends nothing without a supervisor', () => {
    delete process.env.NOTIFY_SOCKET;

    expect(systemdNotify.notifyReady()).to.equal(false);
    sinon.assert.notCalled(execFileStub);
  });

  it('reports readiness through systemd-notify when systemd is listening', () => {
    process.env.NOTIFY_SOCKET = '/run/systemd/notify';
    execFileStub.callsFake((file, args, callback) => callback(null));

    expect(systemdNotify.notifyReady()).to.equal(true);
    sinon.assert.calledOnceWithExactly(execFileStub, 'systemd-notify', ['--ready'], sinon.match.func);
    sinon.assert.calledOnce(infoStub);
    sinon.assert.notCalled(warnStub);
  });

  it('warns and carries on when systemd-notify fails', () => {
    process.env.NOTIFY_SOCKET = '/run/systemd/notify';
    execFileStub.callsFake((file, args, callback) => callback(new Error('spawn systemd-notify ENOENT')));

    expect(systemdNotify.notifyReady()).to.equal(true);
    sinon.assert.calledOnce(warnStub);
    expect(warnStub.firstCall.args[0]).to.include('ENOENT');
    sinon.assert.notCalled(infoStub);
  });
});
