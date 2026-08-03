const path = require('path');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const { Worker } = require('worker_threads');
const authWorkerRunner = require('../../../ZelBack/src/services/registryAuth/services/authWorkerRunner');

chai.use(chaiAsPromised);
const { expect } = chai;

const workerDir = path.join(__dirname, 'fixtures', 'workers');

describe('authWorkerRunner tests', () => {
  let terminateSpy;

  beforeEach(() => {
    terminateSpy = sinon.spy(Worker.prototype, 'terminate');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should resolve with the result the worker reports', async () => {
    const result = await authWorkerRunner.runAuthWorker('echoWorker', { tenantId: 'tenant-a' }, { workerDir });

    expect(result).to.deep.equal({ echoed: { tenantId: 'tenant-a' } });
  });

  it('should terminate the worker once the exchange is done', async () => {
    await authWorkerRunner.runAuthWorker('echoWorker', {}, { workerDir });

    sinon.assert.calledOnce(terminateSpy);
  });

  it('should reject with the error the worker reports', async () => {
    await expect(
      authWorkerRunner.runAuthWorker('failingWorker', {}, { workerDir }),
    ).to.be.rejectedWith('service principal rejected');

    sinon.assert.calledOnce(terminateSpy);
  });

  it('should reject when the worker exits without answering', async () => {
    await expect(
      authWorkerRunner.runAuthWorker('exitingWorker', {}, { workerDir }),
    ).to.be.rejectedWith(/exited without answering/);
  });

  it('should reject when the worker fails to start', async () => {
    await expect(
      authWorkerRunner.runAuthWorker('throwingWorker', {}, { workerDir }),
    ).to.be.rejectedWith('worker failed to start');
  });

  it('should reject and terminate a worker that never answers', async () => {
    await expect(
      authWorkerRunner.runAuthWorker('silentWorker', {}, { workerDir, timeoutMs: 150 }),
    ).to.be.rejectedWith(/timed out after 150ms/);

    sinon.assert.calledOnce(terminateSpy);
  });

  it('should run repeated exchanges independently', async () => {
    const results = await Promise.all([
      authWorkerRunner.runAuthWorker('echoWorker', { n: 1 }, { workerDir }),
      authWorkerRunner.runAuthWorker('echoWorker', { n: 2 }, { workerDir }),
      authWorkerRunner.runAuthWorker('echoWorker', { n: 3 }, { workerDir }),
    ]);

    expect(results.map((r) => r.echoed.n)).to.deep.equal([1, 2, 3]);
    expect(terminateSpy.callCount).to.equal(3);
  });
});
