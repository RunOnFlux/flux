const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

describe('fluxNodeService tests', () => {
  describe('getHostInfo', () => {
    let fluxNodeService;
    let geolocationService;
    let dbHelperStub;

    // What ip-api fills the record with. The two the reply drops are here, so a
    // reply carrying either is a failure rather than an absence of fixture.
    const storedRecord = {
      ip: '185.199.108.1',
      continent: 'Europe',
      continentCode: 'EU',
      country: 'Germany',
      countryCode: 'DE',
      region: 'HE',
      regionName: 'Hesse',
      lat: 50.1109,
      lon: 8.6821,
      org: 'Hetzner Online GmbH',
      isp: 'Hetzner Online GmbH',
      asn: 'AS24940 Hetzner Online GmbH',
      static: true,
      dataCenter: true,
    };

    function replyFrom(res) {
      return res.json.firstCall.args[0];
    }

    beforeEach(() => {
      const logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };

      // The REAL accessor, over a stubbed database. getHostInfo reaching past
      // the copy and the accessor handing out the record itself are two
      // different defects with one symptom, and a stubbed accessor can only see
      // the first.
      dbHelperStub = {
        databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
        updateOneInDatabase: sinon.stub().resolves(),
        findOneInDatabase: sinon.stub().resolves({
          _id: 'nodeGeolocation',
          geolocation: { ...storedRecord },
          staticIp: true,
          dataCenter: true,
        }),
      };
      geolocationService = proxyquire('../../ZelBack/src/services/geolocationService', {
        'node:dns': { promises: { reverse: sinon.stub().rejects(new Error('ENOTFOUND')) } },
        '../lib/log': logStub,
        './dbHelper': dbHelperStub,
        './serviceHelper': { axiosGet: sinon.stub() },
        './fluxNetworkHelper': {
          getLocalSocketAddress: sinon.stub().resolves('185.199.108.1:16127'),
          hasPublicIpOnInterface: sinon.stub().resolves(true),
        },
      });

      fluxNodeService = proxyquire('../../ZelBack/src/services/fluxNodeService', {
        '../lib/log': logStub,
        './geolocationService': geolocationService,
        './fluxNetworkHelper': { getLocalSocketAddress: sinon.stub().resolves('185.199.108.1:16127') },
        './generalService': {
          obtainNodeCollateralInformation: sinon.stub().resolves({ txhash: 'abc123', txindex: 0 }),
        },
        './dockerService': {
          getAppNameByContainerIp: sinon.stub().resolves('myapp'),
        },
        './benchmarkService': {
          getBenchmarks: sinon.stub().resolves({
            status: 'success',
            data: {
              status: 'CUMULUS',
              cores: 8,
              ram: 7.1,
              disk: 220,
              diskwritespeed: 540.25,
              eps: 489.2,
              download_speed: 150.45,
              upload_speed: 50.21,
            },
          }),
        },
      });
    });

    afterEach(() => {
      sinon.restore();
    });

    function callerInsideTheDockerNetwork() {
      return { socket: { remoteAddress: '172.23.0.2' } };
    }

    it('answers without the address and operator fields', async () => {
      const res = { json: sinon.stub() };

      await fluxNodeService.getHostInfo(callerInsideTheDockerNetwork(), res);

      const { data } = replyFrom(res);
      expect(data.geo).to.not.have.property('ip');
      expect(data.geo).to.not.have.property('org');
    });

    it('answers with the rest of the record, so the trim is two fields and not a rebuild', async () => {
      const res = { json: sinon.stub() };

      await fluxNodeService.getHostInfo(callerInsideTheDockerNetwork(), res);

      const { data } = replyFrom(res);
      const sent = Object.keys(data.geo).sort();
      const expected = Object.keys(storedRecord).filter((k) => k !== 'ip' && k !== 'org').sort();
      expect(sent).to.eql(expected);
      expect(data.geo.regionName).to.equal('Hesse');
    });

    it('carries the node address once, at the top level and live', async () => {
      const res = { json: sinon.stub() };

      await fluxNodeService.getHostInfo(callerInsideTheDockerNetwork(), res);

      expect(replyFrom(res).data.ip).to.equal('185.199.108.1');
    });

    it('leaves the node still knowing where it is', async () => {
      // The defect this endpoint carried: the removals above landed on the
      // node's own record, so it could no longer resolve itself in the
      // published location table and refused every region-pinned app.
      const res = { json: sinon.stub() };

      await fluxNodeService.getHostInfo(callerInsideTheDockerNetwork(), res);

      const known = await geolocationService.getNodeGeolocation();
      expect(known.ip).to.equal('185.199.108.1');
      expect(known.org).to.equal('Hetzner Online GmbH');
    });

    it('still knows where it is after a second container asks', async () => {
      await fluxNodeService.getHostInfo(callerInsideTheDockerNetwork(), { json: sinon.stub() });
      await fluxNodeService.getHostInfo(callerInsideTheDockerNetwork(), { json: sinon.stub() });

      const known = await geolocationService.getNodeGeolocation();
      expect(known.ip).to.equal('185.199.108.1');
      expect(known.org).to.equal('Hetzner Online GmbH');
    });

    it('refuses a caller it cannot match to a container', async () => {
      const service = proxyquire('../../ZelBack/src/services/fluxNodeService', {
        '../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
        './dockerService': { getAppNameByContainerIp: sinon.stub().resolves(null) },
      });
      const res = { json: sinon.stub() };

      await service.getHostInfo({ socket: { remoteAddress: '10.0.0.9' } }, res);

      expect(replyFrom(res).status).to.equal('error');
    });
  });
});
