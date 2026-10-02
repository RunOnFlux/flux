const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');
const sinon = require('sinon');

const networkDefaults = require('../../ZelBack/src/services/utils/networkDefaults');

describe('networkDefaults tests', () => {
  describe('setConnectAttemptTimeout tests', () => {
    let original;

    beforeEach(() => {
      original = net.getDefaultAutoSelectFamilyAttemptTimeout();
    });

    afterEach(() => {
      sinon.restore();
      net.setDefaultAutoSelectFamilyAttemptTimeout(original);
    });

    it('should raise the per-address connect attempt timeout above one far round trip', () => {
      const result = networkDefaults.setConnectAttemptTimeout();

      expect(result).to.equal(true);
      expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).to.equal(networkDefaults.CONNECT_ATTEMPT_TIMEOUT_MS);
      // Australia to Docker Hub's US East registry measured 270-310 ms; Node's default is 250.
      expect(networkDefaults.CONNECT_ATTEMPT_TIMEOUT_MS).to.be.at.least(1_000);
    });

    it('should do nothing on a Node without the API', () => {
      // Removed by hand: sinon will not replace a function with a non-function.
      const setter = net.setDefaultAutoSelectFamilyAttemptTimeout;
      net.setDefaultAutoSelectFamilyAttemptTimeout = undefined;
      try {
        expect(networkDefaults.setConnectAttemptTimeout()).to.equal(false);
      } finally {
        net.setDefaultAutoSelectFamilyAttemptTimeout = setter;
      }
    });
  });

  describe('worker coverage tests', () => {
    // A worker thread has its own node:net, so the main isolate's default never reaches it.
    // Every worker that makes outbound requests must set it itself.
    const workersDir = path.join(__dirname, '../../ZelBack/src/services/workers');
    const outboundWorkers = ['awsEcrAuthWorker.js', 'googleGarAuthWorker.js', 'azureAcrAuthWorker.js'];

    outboundWorkers.forEach((file) => {
      it(`${file} should set the connect attempt timeout in its own thread`, () => {
        const source = fs.readFileSync(path.join(workersDir, file), 'utf8');

        expect(source).to.include("require('../utils/networkDefaults').setConnectAttemptTimeout();");
      });
    });
  });
});
