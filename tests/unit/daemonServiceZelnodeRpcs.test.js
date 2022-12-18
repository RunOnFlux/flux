const sinon = require('sinon');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper').default;
const daemonServiceZelnodeRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceZelnodeRpcs').default;

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('daemonServiceZelnodeRpcs tests', () => {
  describe('getZelNodeStatus tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeStatus();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodestatus');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeStatus(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodestatus');
    });
  });

  describe('getZelNodeCount tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeCount();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodecount');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeCount(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodecount');
    });
  });

  describe('getDOSList tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getDOSList();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getdoslist');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getDOSList(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getdoslist');
    });
  });

  describe('getStartList tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getStartList();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getstartlist');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getStartList(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getstartlist');
    });
  });

  describe('zelNodeCurrentWinner tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.zelNodeCurrentWinner();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zelnodecurrentwinner');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.zelNodeCurrentWinner(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zelnodecurrentwinner');
    });
  });

  describe('zelNodeDebug tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.zelNodeDebug();

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zelnodedebug');
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');

      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.zelNodeDebug(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'zelnodedebug');
    });
  });

  describe('listZelNodes tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.listZelNodes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodes', []);
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.listZelNodes(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodes', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          filter: 'testing',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.listZelNodes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodes', [req.params.filter]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          filter: 'testing',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.listZelNodes(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodes', [req.query.filter]);
    });
  });

  describe('decodeZelNodeBroadcast tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.decodeZelNodeBroadcast(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'decodezelnodebroadcast', []);
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.decodeZelNodeBroadcast(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'decodezelnodebroadcast', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          hexstring: '12347890ADC',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.decodeZelNodeBroadcast(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'decodezelnodebroadcast', [req.params.hexstring]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          hexstring: '12347890ADC',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.decodeZelNodeBroadcast(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'decodezelnodebroadcast', [req.query.hexstring]);
    });
  });

  describe('getZelNodeScores tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeScores(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodescores', ['10']);
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeScores(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodescores', ['10']);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          blocks: '1345',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeScores(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodescores', [req.params.blocks]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          blocks: '1345',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeScores(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodescores', [req.query.blocks]);
    });
  });

  describe('getZelNodeWinners tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeWinners(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodewinners', ['10']);
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeWinners(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodewinners', ['10']);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          blocks: '1345',
          filter: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeWinners(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodewinners', [req.params.blocks, req.params.filter]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          blocks: '1345',
          filter: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeWinners(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodewinners', [req.query.blocks, req.query.filter]);
    });
  });

  describe('relayZelNodeBroadcast tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.relayZelNodeBroadcast(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'relayzelnodebroadcast', []);
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.relayZelNodeBroadcast(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'relayzelnodebroadcast', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          hexstring: '1345ACF',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.relayZelNodeBroadcast(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'relayzelnodebroadcast', [req.params.hexstring]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          hexstring: '1345ACF',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.relayZelNodeBroadcast(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'relayzelnodebroadcast', [req.query.hexstring]);
    });
  });

  describe('spork tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.spork(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'spork', ['show']);
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.spork(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'spork', ['show']);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          name: 'active',
          value: '10',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.spork(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'spork', [req.params.name, +req.params.value]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          name: 'active',
          value: 10,
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.spork(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'spork', [req.query.name, req.query.value]);
    });
  });

  describe('viewDeterministicZelNodeList tests', () => {
    let daemonServiceUtilsStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should trigger rpc, no parameters, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.viewDeterministicZelNodeList(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'viewdeterministiczelnodelist', []);
    });

    it('should trigger rpc, response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.viewDeterministicZelNodeList(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'viewdeterministiczelnodelist', []);
    });

    it('should trigger rpc, data passed in params, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          filter: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.viewDeterministicZelNodeList(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'viewdeterministiczelnodelist', [req.params.filter]);
    });

    it('should trigger rpc, data passed in query, no response passed', async () => {
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          filter: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.viewDeterministicZelNodeList(req);

      expect(result).to.equal(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'viewdeterministiczelnodelist', [req.query.filter]);
    });
  });

  describe('listZelNodeConf tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          filter: 'testfilter',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceZelnodeRpcs.listZelNodeConf(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          filter: 'testfilter',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.listZelNodeConf(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodeconf', [req.params.filter]);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          filter: 'testfilter',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.listZelNodeConf(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodeconf', [req.query.filter]);
    });

    it('should trigger rpc, even without params', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test1: 'node1',
          test2: 'myCommand',
        },
        query: {
          test: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.listZelNodeConf(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodeconf', []);
    });

    it('should trigger rpc, all parameters passed in params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          filter: 'testfilter',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZelnodeRpcs.listZelNodeConf(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'listzelnodeconf', [req.params.filter]);
    });
  });

  describe('createZelNodeKey tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceZelnodeRpcs.createZelNodeKey(undefined);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          filter: 'testfilter',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.createZelNodeKey(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createzelnodekey');
    });

    it('should trigger rpc,response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZelnodeRpcs.createZelNodeKey(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createzelnodekey');
    });
  });

  describe('znsync tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          mode: 'testmode',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceZelnodeRpcs.znsync(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, mode = status, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          mode: 'status',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.znsync(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(verifyPrivilegeStub);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'znsync', [req.params.mode]);
    });

    it('should trigger rpc, user authorized, mode = testmode, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          mode: 'testmode',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.znsync(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnce(verifyPrivilegeStub);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'znsync', [req.params.mode]);
    });

    it('should trigger rpc, all parameters passed in query, mode = status, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          mode: 'status',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.znsync(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(verifyPrivilegeStub);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'znsync', [req.query.mode]);
    });

    it('should trigger rpc, no parameters passed, mode = status by default, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.znsync(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(verifyPrivilegeStub);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'znsync', ['status']);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          filter: 'status',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.znsync(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'znsync', [req.query.filter]);
    });

    it('should trigger rpc, all parameters passed in params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          mode: 'status',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZelnodeRpcs.znsync(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'znsync', [req.params.mode]);
    });
  });

  describe('createZelNodeBroadcast tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          command: 'testcommand',
          alias: 'alias1',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceZelnodeRpcs.createZelNodeBroadcast(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          command: 'testcommand',
          alias: 'alias1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.createZelNodeBroadcast(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createzelnodebroadcast', [req.params.command, req.params.alias]);
    });

    it('should trigger rpc, no commands param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          alias: 'alias1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.createZelNodeBroadcast(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createzelnodebroadcast', ['', req.params.alias]);
    });

    it('should trigger rpc, no alias param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          command: 'testcommand',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.createZelNodeBroadcast(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createzelnodebroadcast', [req.params.command, '']);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          command: 'testcommand',
          alias: 'alias1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.createZelNodeBroadcast(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createzelnodebroadcast', [req.query.command, req.query.alias]);
    });

    it('should trigger rpc, even without params', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test1: 'node1',
          test2: 'myCommand',
        },
        query: {
          test: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.createZelNodeBroadcast(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createzelnodebroadcast', ['', '']);
    });

    it('should trigger rpc, all parameters passed in params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          command: 'testcommand',
          alias: 'alias1',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZelnodeRpcs.createZelNodeBroadcast(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'createzelnodebroadcast', [req.params.command, req.params.alias]);
    });
  });

  describe('getZelNodeOutputs tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceZelnodeRpcs.getZelNodeOutputs();

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.getZelNodeOutputs();

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodeoutputs');
    });

    it('should trigger rpc, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');

      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZelnodeRpcs.getZelNodeOutputs(undefined, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'getzelnodeoutputs');
    });
  });

  describe('startDeterministicZelNode tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          lockwallet: 'false',
          alias: 'alias1',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceZelnodeRpcs.startDeterministicZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          lockwallet: 'false',
          alias: 'alias1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.startDeterministicZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startdeterministiczelnode', ['alias1', false]);
    });

    it('should trigger rpc, no lockwallet param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          alias: 'alias1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.startDeterministicZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startdeterministiczelnode', ['alias1', false]);
    });

    it('should trigger rpc, no alias param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          lockwallet: 'true',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.startDeterministicZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startdeterministiczelnode', [undefined, true]);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          lockwallet: true,
          alias: 'alias1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.startDeterministicZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startdeterministiczelnode', ['alias1', true]);
    });

    it('should trigger rpc, even without params', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test1: 'node1',
          test2: 'myCommand',
        },
        query: {
          test: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.startDeterministicZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startdeterministiczelnode', [undefined, false]);
    });

    it('should trigger rpc, all parameters passed in params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          lockwallet: false,
          alias: 'alias1',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZelnodeRpcs.startDeterministicZelNode(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startdeterministiczelnode', ['alias1', false]);
    });
  });

  describe('startZelNode tests', () => {
    let daemonServiceUtilsStub;
    let verifyPrivilegeStub;

    beforeEach(() => {
      daemonServiceUtilsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if user is unauthorized, no response passed', async () => {
      verifyPrivilegeStub.returns(false);
      const req = {
        params: {
          lockwallet: 'false',
          alias: 'alias1',
          set: 'set1',
        },
      };
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };

      const result = await daemonServiceZelnodeRpcs.startZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.notCalled(daemonServiceUtilsStub);
    });

    it('should trigger rpc, all parameters passed in params, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          lockwallet: false,
          alias: 'alias1',
          set: 'set1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.startZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', ['set1', false, 'alias1']);
    });

    it('should trigger rpc, no lockwallet param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          alias: 'alias1',
          set: 'set1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.startZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', ['set1', undefined, 'alias1']);
    });

    it('should trigger rpc, no set param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          alias: 'alias1',
          lockwallet: false,
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.startZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', [undefined, false, 'alias1']);
    });

    it('should trigger rpc, no alias param, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          lockwallet: 'true',
          set: 'set1',
        },
        query: {
          test: 'test',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.startZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', ['set1', 'true']);
    });

    it('should trigger rpc, all parameters passed in query, no response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          lockwallet: false,
          alias: 'alias1',
          set: 'set1',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.startZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', ['set1', false, 'alias1']);
    });

    it('should trigger rpc, even without params', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          test1: 'node1',
          test2: 'myCommand',
        },
        query: {
          test: 'test2',
        },
      };
      const expectedResponse = 'success';

      const result = await daemonServiceZelnodeRpcs.startZelNode(req);

      expect(result).to.eql(expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', [undefined, undefined]);
    });

    it('should trigger rpc, all parameters passed in params, response passed', async () => {
      verifyPrivilegeStub.returns(true);
      daemonServiceUtilsStub.returns('success');
      const req = {
        params: {
          lockwallet: false,
          alias: 'alias1',
          set: 'set1',
        },
      };
      const expectedResponse = 'success';
      const res = generateResponse();

      const result = await daemonServiceZelnodeRpcs.startZelNode(req, res);

      expect(result).to.equal(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
      sinon.assert.calledOnceWithExactly(daemonServiceUtilsStub, 'startzelnode', ['set1', false, 'alias1']);
    });
  });
});
