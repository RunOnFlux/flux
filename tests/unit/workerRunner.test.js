const path = require('path');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const { Worker } = require('worker_threads');
const workerRunner = require('../../ZelBack/src/services/utils/workerRunner');

chai.use(chaiAsPromised);
const { expect } = chai;

const workerDir = path.join(__dirname, 'fixtures', 'workers');

describe('workerRunner tests', () => {
  let terminateSpy;

  beforeEach(() => {
    terminateSpy = sinon.spy(Worker.prototype, 'terminate');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should resolve with the result the worker reports', async () => {
    const result = await workerRunner.runInWorker('echoWorker', { tenantId: 'tenant-a' }, { workerDir });

    expect(result).to.deep.equal({ echoed: { tenantId: 'tenant-a' } });
  });

  it('should terminate the worker once the exchange is done', async () => {
    await workerRunner.runInWorker('echoWorker', {}, { workerDir });

    sinon.assert.calledOnce(terminateSpy);
  });

  it('should reject with the error the worker reports', async () => {
    await expect(
      workerRunner.runInWorker('failingWorker', {}, { workerDir }),
    ).to.be.rejectedWith('service principal rejected');

    sinon.assert.calledOnce(terminateSpy);
  });

  it('should reject when the worker exits without answering', async () => {
    await expect(
      workerRunner.runInWorker('exitingWorker', {}, { workerDir }),
    ).to.be.rejectedWith(/exited without answering/);
  });

  it('should reject when the worker fails to start', async () => {
    await expect(
      workerRunner.runInWorker('throwingWorker', {}, { workerDir }),
    ).to.be.rejectedWith('worker failed to start');
  });

  it('should reject and terminate a worker that never answers', async () => {
    await expect(
      workerRunner.runInWorker('silentWorker', {}, { workerDir, timeoutMs: 150 }),
    ).to.be.rejectedWith(/timed out after 150ms/);

    sinon.assert.calledOnce(terminateSpy);
  });

  it('should run repeated exchanges independently', async () => {
    const results = await Promise.all([
      workerRunner.runInWorker('echoWorker', { n: 1 }, { workerDir }),
      workerRunner.runInWorker('echoWorker', { n: 2 }, { workerDir }),
      workerRunner.runInWorker('echoWorker', { n: 3 }, { workerDir }),
    ]);

    expect(results.map((r) => r.echoed.n)).to.deep.equal([1, 2, 3]);
    expect(terminateSpy.callCount).to.equal(3);
  });
  it('should reject a failure that carries no message rather than resolving it as success', async () => {
    await expect(
      workerRunner.runInWorker('messagelessFailureWorker', {}, { workerDir }),
    ).to.be.rejectedWith(/failed without a reason/);

    sinon.assert.calledOnce(terminateSpy);
  });
});
