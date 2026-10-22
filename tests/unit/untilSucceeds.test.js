const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('untilSucceeds', () => {
  let delay;
  let untilSucceeds;
  let BOOT_STEP_RETRY_MS;

  beforeEach(() => {
    delay = sinon.stub().resolves();
    ({ untilSucceeds, BOOT_STEP_RETRY_MS } = proxyquire('../../ZelBack/src/services/utils/untilSucceeds', {
      '../serviceHelper': { delay },
      '../../lib/log': { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() },
    }));
  });

  it('answers what the step resolved, without waiting, when it succeeds at once', async () => {
    const step = sinon.stub().resolves('done');

    expect(await untilSucceeds('a step', step)).to.equal('done');

    sinon.assert.calledOnce(step);
    sinon.assert.notCalled(delay);
  });

  it('runs a failing step again after each wait until it succeeds', async () => {
    const step = sinon.stub();
    step.onCall(0).rejects(new Error('database did not answer'));
    step.onCall(1).rejects(new Error('database did not answer'));
    step.onCall(2).resolves('done');

    expect(await untilSucceeds('a step', step)).to.equal('done');

    sinon.assert.calledThrice(step);
    expect(delay.args).to.deep.equal([[BOOT_STEP_RETRY_MS], [BOOT_STEP_RETRY_MS]]);
  });
});
