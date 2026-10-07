const { expect } = require('chai');
const sinon = require('sinon');

const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const ufw = require('../../ZelBack/src/services/utils/ufw');

describe('ufw runner', () => {
  let runCommand;

  beforeEach(() => {
    runCommand = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: 'Rule added\n', stderr: '' });
  });

  afterEach(() => {
    sinon.restore();
  });

  const exited = (code) => ({ error: Object.assign(new Error(`exit ${code}`), { code }), stdout: '', stderr: '' });
  // A command that does not finish until released.
  const held = () => {
    let release;
    const answer = new Promise((resolve) => { release = () => resolve({ error: null, stdout: '', stderr: '' }); });
    return { answer, release };
  };

  it('runs a command through the lock-first helper as root, its arguments as given', async () => {
    const result = await ufw.runUfw(['allow', 'from', '::/0', 'to', 'any', 'port', '31000']);

    sinon.assert.calledOnceWithExactly(runCommand, 'python3', {
      runAsRoot: true,
      logError: false,
      params: [ufw.UFW_HELPER, '--wait', '30', '--command', '["allow","from","::/0","to","any","port","31000"]'],
      timeout: 60000,
    });
    expect(result).to.deep.equal({ error: null, stdout: 'Rule added\n', stderr: '', locked: false });
  });

  it('reports the lock held past the wait, by the helper or by the timeout', async () => {
    runCommand.resolves(exited(75));
    expect((await ufw.runUfw(['allow', '31000'])).locked).to.equal(true);

    runCommand.resolves({ error: Object.assign(new Error('killed'), { killed: true }), stdout: '', stderr: '' });
    expect((await ufw.runUfw(['allow', '31000'])).locked).to.equal(true);

    runCommand.resolves(exited(1));
    expect((await ufw.runUfw(['allow', '31000'])).locked).to.equal(false);
  });

  it('runs the ufw command when ufw\'s library cannot be used', async () => {
    runCommand.onFirstCall().resolves(exited(69));

    const result = await ufw.runUfw(['allow', '31000']);

    sinon.assert.calledTwice(runCommand);
    sinon.assert.calledWithExactly(runCommand.secondCall, 'ufw', {
      runAsRoot: true, logError: false, params: ['allow', '31000'], timeout: 30000,
    });
    expect(result).to.deep.equal({ error: null, stdout: 'Rule added\n', stderr: '', locked: false });
  });

  it('starts no ufw command while another FluxOS started is running', async () => {
    const first = held();
    runCommand.onFirstCall().returns(first.answer);

    const running = ufw.runUfw(['allow', '31000']);
    const queued = ufw.runUfw(['allow', '31001']);
    await new Promise((resolve) => { setImmediate(resolve); });
    sinon.assert.calledOnce(runCommand);

    first.release();
    await Promise.all([running, queued]);
    sinon.assert.calledTwice(runCommand);
  });

  it('starts the next task after one that failed', async () => {
    const failed = ufw.oneAtATime(async () => { throw new Error('failed'); });
    const next = ufw.oneAtATime(async () => 'ran');

    await failed.catch(() => {});
    expect(await next).to.equal('ran');
  });
});
