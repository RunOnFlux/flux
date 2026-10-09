const { expect } = require('chai');
const sinon = require('sinon');

const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const ufw = require('../../ZelBack/src/services/utils/ufw');
const ufwHelper = require('../../ZelBack/src/services/utils/ufwHelper');

describe('ufw runner', () => {
  let runCommand;

  beforeEach(() => {
    runCommand = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: 'Rule added\n', stderr: '' });
    // The installed copy of the helper is the one to run (utils/ufwHelper has its own tests).
    sinon.stub(ufwHelper, 'path').resolves(ufwHelper.UFW_HELPER);
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

  describe('a batch of ufw commands', () => {
    const commands = [['allow', '31000'], ['allow', '31001']];
    const answered = (result) => ({ error: null, stdout: `${JSON.stringify({ removed: 0, applied: true, failed: [], reason: null, ...result })}\n`, stderr: '' });

    it('runs them through the helper in one process, keeping every outbound rule', async () => {
      runCommand.resolves(answered());

      expect(await ufw.runUfwCommands(commands)).to.deep.equal({ failed: [], locked: false });
      sinon.assert.calledOnceWithExactly(runCommand, 'python3', {
        runAsRoot: true,
        logError: false,
        params: [ufw.UFW_HELPER, '--wait', '30', '--keep-outbound', '--rules', JSON.stringify(commands)],
        timeout: 60000,
      });
    });

    it('reports the commands ufw refused, and a lock held past the wait', async () => {
      const failed = [{ rule: 'allow 31001', error: 'ERROR: Bad port' }];
      runCommand.resolves(answered({ failed }));
      expect(await ufw.runUfwCommands(commands)).to.deep.equal({ failed, locked: false });

      runCommand.resolves(exited(75));
      expect(await ufw.runUfwCommands(commands)).to.deep.equal({ failed: [], locked: true });
    });

    it('runs each as a ufw command when ufw\'s library cannot be used, stopping at one locked out', async () => {
      runCommand.onFirstCall().resolves(answered({ applied: false, reason: 'ufw library not usable' }));
      runCommand.onSecondCall().resolves({ ...exited(1), stderr: 'ERROR: Bad port\n' });
      runCommand.onThirdCall().resolves({ error: Object.assign(new Error('killed'), { killed: true }), stdout: '', stderr: '' });

      const result = await ufw.runUfwCommands([...commands, ['allow', '31002']]);

      expect(result).to.deep.equal({ failed: [{ rule: 'allow 31000', error: 'ERROR: Bad port' }], locked: true });
      expect(runCommand.getCalls().slice(1).map((call) => [call.args[0], call.args[1].params])).to.deep.equal([
        ['ufw', ['allow', '31000']],
        ['ufw', ['allow', '31001']],
      ]);
    });

    it('runs nothing for no commands', async () => {
      expect(await ufw.runUfwCommands([])).to.deep.equal({ failed: [], locked: false });
      sinon.assert.notCalled(runCommand);
    });
  });

  it('starts the next task after one that failed', async () => {
    const failed = ufw.oneAtATime(async () => { throw new Error('failed'); });
    const next = ufw.oneAtATime(async () => 'ran');

    await failed.catch(() => {});
    expect(await next).to.equal('ran');
  });
});
