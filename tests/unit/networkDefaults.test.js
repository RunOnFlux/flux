const net = require('node:net');
const dns = require('node:dns');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { Worker } = require('node:worker_threads');
const { expect } = require('chai');

const networkDefaults = require('../../ZelBack/src/services/utils/networkDefaults');
const workerRunner = require('../../ZelBack/src/services/utils/workerRunner');
const verifyPool = require('../../ZelBack/src/services/utils/verifyPool');

const fixtures = path.join(__dirname, 'fixtures', 'workers');
const reportingWorker = path.join(fixtures, 'networkDefaultsWorker.js');

const APPLIED = { attemptMs: networkDefaults.CONNECT_ATTEMPT_TIMEOUT_MS, order: networkDefaults.DNS_RESULT_ORDER };

async function reportFrom(worker) {
  worker.postMessage({});
  const [message] = await once(worker, 'message');
  await worker.terminate();
  return message.result;
}

function listJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

describe('networkDefaults tests', () => {
  let originalAttemptMs;
  let originalOrder;

  beforeEach(() => {
    originalAttemptMs = net.getDefaultAutoSelectFamilyAttemptTimeout();
    originalOrder = dns.getDefaultResultOrder();
  });

  afterEach(() => {
    net.setDefaultAutoSelectFamilyAttemptTimeout(originalAttemptMs);
    dns.setDefaultResultOrder(originalOrder);
  });

  describe('applyNetworkDefaults tests', () => {
    it('should set the connect attempt timeout and IPv4-first lookups for the calling thread', () => {
      net.setDefaultAutoSelectFamilyAttemptTimeout(250);
      dns.setDefaultResultOrder('verbatim');

      networkDefaults.applyNetworkDefaults();

      expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).to.equal(2_000);
      expect(dns.getDefaultResultOrder()).to.equal('ipv4first');
    });
  });

  describe('createWorker tests', () => {
    it('should start the worker with the defaults in effect in its own thread', async () => {
      // The main thread's values must not be the applied ones, or a worker reading them back
      // could not tell inheritance from application.
      net.setDefaultAutoSelectFamilyAttemptTimeout(250);
      dns.setDefaultResultOrder('verbatim');

      const result = await reportFrom(networkDefaults.createWorker(reportingWorker));

      expect(result).to.deep.equal(APPLIED);
    });

    it('should leave a worker started without it at Node\'s own defaults', async () => {
      // Canary for the test above: the fixture reads the thread's defaults, and a worker does
      // not pick them up from the thread that started it.
      networkDefaults.applyNetworkDefaults();

      const result = await reportFrom(new Worker(reportingWorker));

      expect(result).to.not.deep.equal(APPLIED);
    });

    it('should surface a worker script that fails to load as the worker\'s error', async () => {
      const worker = networkDefaults.createWorker(path.join(fixtures, 'throwOnLoadWorker.js'));

      const [error] = await once(worker, 'error');

      expect(error.message).to.equal('worker script failed to load');
    });
  });

  describe('spawn site tests', () => {
    it('should give a workerRunner worker the defaults', async () => {
      const result = await workerRunner.runInWorker('networkDefaultsWorker', {}, { workerDir: fixtures });

      expect(result).to.deep.equal(APPLIED);
    });

    it('should give a verifyPool worker the defaults', async () => {
      verifyPool.stop();
      verifyPool.start(1, { workerPath: reportingWorker });
      try {
        const results = await verifyPool.verify([{ messageToVerify: 'a', pubKey: 'b', signature: 'c' }]);

        expect(results).to.deep.equal([APPLIED]);
      } finally {
        verifyPool.stop();
      }
    });

    it('should create every worker in the product through createWorker', () => {
      const root = path.join(__dirname, '../../ZelBack');
      const spawning = listJsFiles(root)
        .filter((file) => fs.readFileSync(file, 'utf8').includes('new Worker('))
        .map((file) => path.relative(root, file));

      // networkDefaults itself is the one place a Worker is constructed; finding it proves the
      // scan reads the files it should.
      expect(spawning).to.deep.equal([path.join('src', 'services', 'utils', 'networkDefaults.js')]);
    });
  });
});
