/* eslint-disable class-methods-use-this */
/* eslint-disable no-restricted-syntax */
import chai from 'chai';
import natUpnp from '@runonflux/nat-upnp';
import sinon from 'sinon';
import proxyquire from 'proxyquire';
import log from '../../ZelBack/src/lib/log.js';
log.default;
import verificationHelper from '../../ZelBack/src/services/verificationHelper.js';
verificationHelper.default;

const { expect } = chai;

const config = {
  apiport: '5550',
};

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  res.write = sinon.fake(() => 'written');
  res.end = sinon.fake(() => true);
  res.writeHead = sinon.fake(() => true);
  res.download = sinon.fake(() => true);
  return res;
};

const upnpService = proxyquire('../../ZelBack/src/services/upnpService',
  { config });

describe('upnpService tests', () => {
  describe('verifyUPNPsupport tests', () => {
    let logSpy;

    beforeEach(() => {
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if all client responses are valid', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getGateway').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getMappings').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const result = await upnpService.verifyUPNPsupport();

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
    });

    it('should log a proper error if getPublicIp throws', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').throws();
      sinon.stub(natUpnp.Client.prototype, 'getGateway').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getMappings').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const result = await upnpService.verifyUPNPsupport();

      expect(result).to.equal(false);
      sinon.assert.calledTwice(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed get public ip');
    });

    it('should log a proper error if getGateway throws', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getGateway').throws();
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getMappings').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const result = await upnpService.verifyUPNPsupport();

      expect(result).to.equal(false);
      sinon.assert.calledTwice(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed get Gateway');
    });

    it('should log a proper error if createMapping throws', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getGateway').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'createMapping').throws();
      sinon.stub(natUpnp.Client.prototype, 'getMappings').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const result = await upnpService.verifyUPNPsupport();

      expect(result).to.equal(false);
      sinon.assert.calledTwice(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed Create Mapping');
    });

    it('should log a proper error if getMappings throws', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getGateway').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getMappings').throws();
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const result = await upnpService.verifyUPNPsupport();

      expect(result).to.equal(false);
      sinon.assert.calledTwice(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed get Mappings');
    });

    it('should log a proper error if removeMapping throws', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getGateway').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getMappings').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').throws();

      const result = await upnpService.verifyUPNPsupport();

      expect(result).to.equal(false);
      sinon.assert.calledTwice(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed Remove Mapping');
    });
  });

  describe('setupUPNP tests', () => {
    let logSpy;
    let createMappingSpy;

    beforeEach(() => {
      logSpy = sinon.spy(log, 'error');
      createMappingSpy = sinon.stub(natUpnp.Client.prototype, 'createMapping');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if all client responses are valid', async () => {
      createMappingSpy.returns(true);

      const result = await upnpService.setupUPNP(123);

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledThrice(createMappingSpy);
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 123, private: 123, ttl: 0, description: 'Flux_Backend_API',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 122, private: 122, ttl: 0, description: 'Flux_Home_UI',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 125, private: 125, ttl: 0, description: 'Flux_Syncthing',
      });
    });

    it('should return true if all client responses are valid, no parameter passed', async () => {
      createMappingSpy.returns(true);

      const result = await upnpService.setupUPNP();

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledThrice(createMappingSpy);
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 5550, private: 5550, ttl: 0, description: 'Flux_Backend_API',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 5549, private: 5549, ttl: 0, description: 'Flux_Home_UI',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 5552, private: 5552, ttl: 0, description: 'Flux_Syncthing',
      });
    });

    it('should return error if client response throws', async () => {
      createMappingSpy.throws();

      const result = await upnpService.setupUPNP(123);

      expect(result).to.equal(false);
      sinon.assert.calledOnce(logSpy);
    });
  });

  describe('mapUpnpPort tests', () => {
    let logSpy;
    let createMappingSpy;

    beforeEach(() => {
      logSpy = sinon.spy(log, 'error');
      createMappingSpy = sinon.stub(natUpnp.Client.prototype, 'createMapping');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if all client responses are valid', async () => {
      createMappingSpy.returns(true);

      const result = await upnpService.mapUpnpPort(123, 'some description');

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledTwice(createMappingSpy);
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 123,
        private: 123,
        ttl: 0,
        protocol: 'TCP',
        description: 'some description',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 123,
        private: 123,
        ttl: 0,
        protocol: 'UDP',
        description: 'some description',
      });
    });

    it('should return error if client response throws', async () => {
      createMappingSpy.throws();

      const result = await upnpService.mapUpnpPort(123);

      expect(result).to.equal(false);
      sinon.assert.calledOnce(logSpy);
    });
  });

  describe('removeMapUpnpPort tests', () => {
    let logSpy;
    let removeMappingSpy;

    beforeEach(() => {
      logSpy = sinon.spy(log, 'error');
      removeMappingSpy = sinon.stub(natUpnp.Client.prototype, 'removeMapping');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if all client responses are valid', async () => {
      removeMappingSpy.returns(true);

      const result = await upnpService.removeMapUpnpPort(123, 'some description');

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledTwice(removeMappingSpy);
      sinon.assert.calledWithExactly(removeMappingSpy, { public: 123, protocol: 'TCP' });
      sinon.assert.calledWithExactly(removeMappingSpy, { public: 123, protocol: 'UDP' });
    });

    it('should return error if client response throws', async () => {
      removeMappingSpy.throws();

      const result = await upnpService.removeMapUpnpPort(123);

      expect(result).to.equal(false);
      sinon.assert.calledOnce(logSpy);
    });
  });

  describe('mapPortApi tests', () => {
    let verifyPrivilegeStub;
    let createMappingSpy;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      createMappingSpy = sinon.stub(natUpnp.Client.prototype, 'createMapping');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();

      await upnpService.mapPortApi(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should throw error if port is null', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: null,
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.mapPortApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Port address specified.',
        },
      });
    });

    it('should throw error if port is undefined', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          test: 'test2',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.mapPortApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Port address specified.',
        },
      });
    });

    it('should show a proper message if port is given in the params', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: '1234',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.mapPortApi(req, res);

      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 1234,
        private: 1234,
        ttl: 0,
        protocol: 'TCP',
        description: 'Flux_manual_entry',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 1234,
        private: 1234,
        ttl: 0,
        protocol: 'UDP',
        description: 'Flux_manual_entry',
      });
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'Port mapped' },
      });
    });

    it('should show a proper message if port is given in the query', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        query: {
          port: '1234',
        },
        params: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.mapPortApi(req, res);
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 1234,
        private: 1234,
        ttl: 0,
        protocol: 'TCP',
        description: 'Flux_manual_entry',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 1234,
        private: 1234,
        ttl: 0,
        protocol: 'UDP',
        description: 'Flux_manual_entry',
      });
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'Port mapped' },
      });
    });
  });

  describe('removeMapPortApi tests', () => {
    let verifyPrivilegeStub;
    let removeMappingSpy;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      removeMappingSpy = sinon.stub(natUpnp.Client.prototype, 'removeMapping');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();

      await upnpService.removeMapPortApi(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should throw error if port is null', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: null,
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.removeMapPortApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Port address specified.',
        },
      });
    });

    it('should throw error if port is undefined', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          test: 'test2',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.removeMapPortApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Port address specified.',
        },
      });
    });

    it('should show a proper message if port is given in the params', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: '1234',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.removeMapPortApi(req, res);

      sinon.assert.calledWithExactly(removeMappingSpy, {
        public: 1234,
        protocol: 'UDP',
      });
      sinon.assert.calledWithExactly(removeMappingSpy, {
        public: 1234,
        protocol: 'TCP',
      });
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'Port unmapped' },
      });
    });

    it('should show a proper message if port is given in the query', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        query: {
          port: '1234',
        },
        params: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.removeMapPortApi(req, res);

      sinon.assert.calledWithExactly(removeMappingSpy, {
        public: 1234,
        protocol: 'TCP',
      });
      sinon.assert.calledWithExactly(removeMappingSpy, {
        public: 1234,
        protocol: 'UDP',
      });
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'Port unmapped' },
      });
    });
  });

  describe('getMapApi tests', () => {
    let verifyPrivilegeStub;
    let getMappingsSpy;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      getMappingsSpy = sinon.stub(natUpnp.Client.prototype, 'getMappings');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();

      await upnpService.getMapApi(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if getMappings throws', async () => {
      getMappingsSpy.throws();
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          test: 'test2',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.getMapApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: 'Error', message: 'Error' },
      });
    });

    it('should show a proper message if all data is valid', async () => {
      getMappingsSpy.resolves({
        data: 'data1',
      });
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: '1234',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.getMapApi(req, res);

      sinon.assert.calledOnce(getMappingsSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: { data: 'data1' } });
    });
  });

  describe('getIpApi tests', () => {
    let verifyPrivilegeStub;
    let getPublicIpSpy;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      getPublicIpSpy = sinon.stub(natUpnp.Client.prototype, 'getPublicIp');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();

      await upnpService.getIpApi(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if getMappings throws', async () => {
      getPublicIpSpy.throws();
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          test: 'test2',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.getIpApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: 'Error', message: 'Error' },
      });
    });

    it('should show a proper message if all data is valid', async () => {
      getPublicIpSpy.resolves('192.169.1.1');
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: '1234',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.getIpApi(req, res);

      sinon.assert.calledOnce(getPublicIpSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: '192.169.1.1' });
    });
  });

  describe('getGatewayApi tests', () => {
    let verifyPrivilegeStub;
    let getGatewaySpy;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      getGatewaySpy = sinon.stub(natUpnp.Client.prototype, 'getGateway');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();

      await upnpService.getGatewayApi(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if getMappings throws', async () => {
      getGatewaySpy.throws();
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          test: 'test2',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.getGatewayApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: 'Error', message: 'Error' },
      });
    });

    it('should show a proper message if all data is valid', async () => {
      getGatewaySpy.resolves('10.1.1.1');
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: '1234',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.getGatewayApi(req, res);

      sinon.assert.calledOnce(getGatewaySpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: '10.1.1.1' });
    });
  });
});
