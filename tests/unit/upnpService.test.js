/* eslint-disable class-methods-use-this */
/* eslint-disable no-restricted-syntax */
const chai = require('chai');
const natUpnp = require('@runonflux/nat-upnp');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const log = require('../../ZelBack/src/lib/log');

const { expect } = chai;

const config = {
  apiport: '5550',
};

const upnpService = proxyquire('../../ZelBack/src/services/upnpService',
  { config });

describe.only('upnpService tests', () => {
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
      sinon.assert.calledTwice(createMappingSpy);
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 123, private: 123, ttl: 0, description: 'Flux_Backend_API',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 122, private: 122, ttl: 0, description: 'Flux_Home_UI',
      });
    });

    it('should return true if all client responses are valid, no parameter passed', async () => {
      createMappingSpy.returns(true);

      const result = await upnpService.setupUPNP();

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledTwice(createMappingSpy);
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 5550, private: 5550, ttl: 0, description: 'Flux_Backend_API',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 5549, private: 5549, ttl: 0, description: 'Flux_Home_UI',
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
        public: 123, private: 123, ttl: 0, description: 'Flux_Backend_API',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 122, private: 122, ttl: 0, description: 'Flux_Home_UI',
      });
    });

    it('should return error if client response throws', async () => {
      createMappingSpy.throws();

      const result = await upnpService.mapUpnpPort(123);

      expect(result).to.equal(false);
      sinon.assert.calledOnce(logSpy);
    });
  });
});
