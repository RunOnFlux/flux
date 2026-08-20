const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('geolocationService tests', () => {
  let geolocationService;
  let dbHelperStub;
  let serviceHelperStub;
  let fluxNetworkHelperStub;
  let logStub;
  let configStub;

  const mockGeolocationData = {
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
    static: true,
    dataCenter: true,
  };

  const mockDbResult = {
    geolocation: mockGeolocationData,
    staticIp: true,
    dataCenter: true,
    lastIpChangeDate: Date.now() - (15 * 24 * 60 * 60 * 1000), // 15 days ago
  };

  beforeEach(() => {
    // The service reschedules itself with setTimeout on every path it takes,
    // including a ten-second retry when no IP is detected. A real timer there
    // outlives this file and re-enters the service against restored stubs, so
    // it reaches the network for the rest of the run. Only setTimeout is faked:
    // the service reads Date for its IP-change window.
    sinon.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });

    // Create stubs
    const mockDb = {
      db: sinon.stub().returns({
        collection: sinon.stub(),
      }),
    };

    dbHelperStub = {
      databaseConnection: sinon.stub().returns(mockDb),
      updateOneInDatabase: sinon.stub().resolves(),
      findOneInDatabase: sinon.stub(),
    };

    serviceHelperStub = {
      axiosGet: sinon.stub(),
    };

    fluxNetworkHelperStub = {
      getLocalSocketAddress: sinon.stub(),
      hasPublicIpOnInterface: sinon.stub(),
    };

    logStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    configStub = {
      database: {
        local: {
          database: 'zelfluxlocaltest',
          collections: {
            geolocation: 'geolocation',
          },
        },
      },
      geolocation: {
        ipApiBaseUrl: 'http://ip-api.com',
      },
      stats: {
        baseUrl: 'https://stats.runonflux.io',
      },
    };

    // Load module with stubs
    geolocationService = proxyquire('../../ZelBack/src/services/geolocationService', {
      config: configStub,
      '../lib/log': logStub,
      './dbHelper': dbHelperStub,
      './serviceHelper': serviceHelperStub,
      './fluxNetworkHelper': fluxNetworkHelperStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('isStaticIP tests', () => {
    it('should return false by default', () => {
      expect(geolocationService.isStaticIP()).to.equal(false);
    });
  });

  describe('isDataCenter tests', () => {
    it('should return false by default', () => {
      expect(geolocationService.isDataCenter()).to.equal(false);
    });
  });

  describe('getLastIpChangeDate tests', () => {
    it('should return null by default', () => {
      expect(geolocationService.getLastIpChangeDate()).to.equal(null);
    });
  });

  describe('hasPublicIp tests', () => {
    it('should return false when fluxNetworkHelper.hasPublicIpOnInterface returns false', async () => {
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(false);

      const result = await geolocationService.hasPublicIp();

      expect(result).to.equal(false);
      sinon.assert.calledOnce(fluxNetworkHelperStub.hasPublicIpOnInterface);
    });

    it('should return true when fluxNetworkHelper.hasPublicIpOnInterface returns true', async () => {
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(true);

      const result = await geolocationService.hasPublicIp();

      expect(result).to.equal(true);
      sinon.assert.calledOnce(fluxNetworkHelperStub.hasPublicIpOnInterface);
    });
  });

  describe('getNodeGeolocation tests', () => {
    it('should return null when no geolocation is stored and db is empty', async () => {
      dbHelperStub.findOneInDatabase.resolves(null);

      const result = await geolocationService.getNodeGeolocation();

      expect(result).to.equal(null);
    });

    it('should return geolocation from database when not in memory', async () => {
      dbHelperStub.findOneInDatabase.resolves(mockDbResult);

      const result = await geolocationService.getNodeGeolocation();

      expect(result).to.deep.equal(mockGeolocationData);
      sinon.assert.calledOnce(logStub.info);
    });

    it('should restore staticIp, dataCenter, and lastIpChangeDate from db', async () => {
      dbHelperStub.findOneInDatabase.resolves(mockDbResult);

      await geolocationService.getNodeGeolocation();

      expect(geolocationService.isStaticIP()).to.equal(true);
      expect(geolocationService.isDataCenter()).to.equal(true);
      expect(geolocationService.getLastIpChangeDate()).to.equal(mockDbResult.lastIpChangeDate);
    });

    it('should return defaults when db connection is not available', async () => {
      dbHelperStub.databaseConnection.returns(null);

      const result = await geolocationService.getNodeGeolocation();

      expect(result).to.equal(null);
    });

    it('should handle db error gracefully', async () => {
      dbHelperStub.findOneInDatabase.rejects(new Error('DB error'));

      const result = await geolocationService.getNodeGeolocation();

      expect(result).to.equal(null);
      sinon.assert.calledOnce(logStub.error);
    });
  });

  describe('setNodeGeolocation tests', () => {
    beforeEach(() => {
      // Setup default successful response
      fluxNetworkHelperStub.getLocalSocketAddress.resolves('185.199.108.1:16127');
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(true);
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success',
          query: '185.199.108.1',
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
          proxy: false,
          hosting: true,
        },
      });
    });

    it('should not proceed if IP is not detected', async () => {
      fluxNetworkHelperStub.getLocalSocketAddress.resolves(null);

      await geolocationService.setNodeGeolocation();

      sinon.assert.calledWith(logStub.error, 'Flux IP not detected. Flux geolocation service is awaiting');
      sinon.assert.notCalled(serviceHelperStub.axiosGet);
    });

    it('should fetch geolocation from ip-api.com', async () => {
      await geolocationService.setNodeGeolocation();

      sinon.assert.calledOnce(serviceHelperStub.axiosGet);
      expect(serviceHelperStub.axiosGet.firstCall.args[0]).to.include('ip-api.com');
    });

    it('should fallback to stats.runonflux.io when ip-api.com fails', async () => {
      serviceHelperStub.axiosGet.onFirstCall().resolves({
        data: { status: 'fail' },
      });
      serviceHelperStub.axiosGet.onSecondCall().resolves({
        data: {
          status: 'success',
          data: mockGeolocationData,
        },
      });

      await geolocationService.setNodeGeolocation();

      sinon.assert.calledTwice(serviceHelperStub.axiosGet);
      expect(serviceHelperStub.axiosGet.secondCall.args[0]).to.include('stats.runonflux.io');
    });

    it('should set dataCenter to true when hosting flag is true', async () => {
      await geolocationService.setNodeGeolocation();

      expect(geolocationService.isDataCenter()).to.equal(true);
    });

    it('should set dataCenter from the operator, not the registrant org', async () => {
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success',
          query: '185.199.108.1',
          org: 'Some Reseller Ltd',
          isp: 'OVH SAS',
          as: 'AS16276 OVH SAS',
          proxy: false,
          hosting: false,
        },
      });

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.isDataCenter()).to.equal(true);
    });

    it('should store geolocation to database', async () => {
      await geolocationService.setNodeGeolocation();

      sinon.assert.calledOnce(dbHelperStub.updateOneInDatabase);
    });

    it('should handle API error gracefully', async () => {
      serviceHelperStub.axiosGet.rejects(new Error('API error'));

      await geolocationService.setNodeGeolocation();

      sinon.assert.called(logStub.error);
    });

    it('claims a static IP for a public address with no recorded change', async () => {
      // Through the whole pass, not just the predicate. A null lastIpChangeDate
      // means this node has never SEEN the address move, which is where every
      // node starts; the address is trusted until an observed change withdraws
      // it. The stability window measures the recovery from that change, and is
      // the only thing it measures.
      await geolocationService.setNodeGeolocation();

      expect(geolocationService.getStaticIpState()).to.equal('STATIC');
      expect(geolocationService.isStaticIP()).to.equal(true);
    });
  });

  describe('static IP is observed, never inferred from the operator', () => {
    function reload() {
      return proxyquire('../../ZelBack/src/services/geolocationService', {
        config: configStub,
        '../lib/log': logStub,
        './dbHelper': dbHelperStub,
        './serviceHelper': serviceHelperStub,
        './fluxNetworkHelper': fluxNetworkHelperStub,
      });
    }

    function ipApiResponse(overrides = {}) {
      return {
        data: {
          status: 'success',
          query: '185.199.108.1',
          org: 'Hetzner Online GmbH',
          isp: 'Hetzner Online GmbH',
          as: 'AS24940 Hetzner Online GmbH',
          proxy: false,
          hosting: false,
          ...overrides,
        },
      };
    }

    beforeEach(() => {
      fluxNetworkHelperStub.getLocalSocketAddress.resolves('185.199.108.1:16127');
      dbHelperStub.findOneInDatabase.resolves(null);
    });

    it('trusts a public address it has never seen change', async () => {
      // Absence of an observed change is this node having started watching
      // after the fact, which every node does exactly once - not evidence that
      // the address moves. Measured on the fleet an address changes on 0.29% of
      // node-days, so refusing here is wrong about ~97% of nodes for ten days,
      // and it lands on all of them together because they upgrade together: 44
      // staticip specs across 202 placements with nowhere to run.
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(true);
      serviceHelperStub.axiosGet.resolves(ipApiResponse());
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.getStaticIpState()).to.equal('STATIC');
      expect(geolocationService.isStaticIP()).to.equal(true);
    });

    it('withdraws it once the address is seen to change, until it is held again', async () => {
      // One observed change is what turns the trust off. The address then earns
      // it back by being held for the stability window, which is what
      // ipFirstSeenAt measures and is the only thing it is for.
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(true);
      serviceHelperStub.axiosGet.resolves(ipApiResponse());
      dbHelperStub.findOneInDatabase.resolves({
        geolocation: { ip: '9.9.9.9' },
        staticIp: true,
        dataCenter: false,
        lastIpChangeDate: null,
        ipFirstSeenAt: Date.now() - (400 * 24 * 60 * 60 * 1000),
        staticIpState: 'STATIC',
        networkClassification: null,
      });
      geolocationService = reload();
      await geolocationService.getNodeGeolocation();

      // The address it comes back with is not the one on record.
      await geolocationService.setNodeGeolocation();

      expect(geolocationService.getStaticIpState()).to.equal('UNKNOWN');
      expect(geolocationService.isStaticIP()).to.equal(false);
    });

    it('seeds the window from the last recorded change, so an upgrade costs nothing', async () => {
      // ipFirstSeenAt is new, so an in-place upgrade has none. lastIpChangeDate
      // is persisted, restored, and says the address has been held since that
      // change - reading it is what stops the window restarting on a node that
      // has held its address for over a year.
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(true);
      serviceHelperStub.axiosGet.resolves(ipApiResponse());
      dbHelperStub.findOneInDatabase.resolves({
        geolocation: { ip: '185.199.108.1' },
        staticIp: true,
        dataCenter: false,
        lastIpChangeDate: Date.now() - (400 * 24 * 60 * 60 * 1000),
        ipFirstSeenAt: null,
        staticIpState: 'STATIC',
        networkClassification: null,
      });
      geolocationService = reload();
      await geolocationService.getNodeGeolocation();

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.getStaticIpState()).to.equal('STATIC');
    });

    it('is STATIC behind NAT when the published table calls the range hosting', async () => {
      // A 1:1-NAT cloud instance holds a genuinely static address that never
      // appears on a local interface, so the interface test alone can never see
      // it - every AWS, Azure, GCP and Oracle box fails it. This is the job the
      // deleted staticIpOrgs list did, on evidence that has been measured.
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(false);
      serviceHelperStub.axiosGet.resolves(ipApiResponse());
      geolocationService = proxyquire('../../ZelBack/src/services/geolocationService', {
        config: configStub,
        '../lib/log': logStub,
        './dbHelper': dbHelperStub,
        './serviceHelper': serviceHelperStub,
        './fluxNetworkHelper': fluxNetworkHelperStub,
        './appPlacement/ipLocationStore': {
          lookup: sinon.stub().resolves({ org: 'a1b2c3d4e5f6', networkClass: 'DATACENTER' }),
          status: sinon.stub().returns({ ready: true, generated: 'x', rowCount: 2000000 }),
        },
      });

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.getStaticIpState()).to.equal('STATIC');
    });

    it('stays DYNAMIC behind NAT when the table calls the range residential', async () => {
      // The old rule granted static to seven consumer ISPs on the fleet -
      // Verizon, Comcast, Free SAS, Bouygues among them - because ip-api
      // flagged them `proxy`, which is a VPN artefact and not an address that
      // stays put.
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(false);
      serviceHelperStub.axiosGet.resolves(ipApiResponse());
      geolocationService = proxyquire('../../ZelBack/src/services/geolocationService', {
        config: configStub,
        '../lib/log': logStub,
        './dbHelper': dbHelperStub,
        './serviceHelper': serviceHelperStub,
        './fluxNetworkHelper': fluxNetworkHelperStub,
        './appPlacement/ipLocationStore': {
          lookup: sinon.stub().resolves({ org: 'a1b2c3d4e5f6', networkClass: 'RESIDENTIAL' }),
          status: sinon.stub().returns({ ready: true, generated: 'x', rowCount: 2000000 }),
        },
      });

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.getStaticIpState()).to.equal('DYNAMIC');
    });

    it('says UNKNOWN when the routing table could not be read, not DYNAMIC', async () => {
      // "There is no public address on any interface" is a fact about the node.
      // "I could not read the routing table" is a fact about this process, and
      // answering the second with the first asserts NAT on a node that may well
      // hold a public address.
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(null);
      serviceHelperStub.axiosGet.resolves(ipApiResponse());
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.getStaticIpState()).to.equal('UNKNOWN');
      expect(geolocationService.isStaticIP()).to.equal(false);
    });

    it('is STATIC once the address has been held for the stability window', async () => {
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(true);
      serviceHelperStub.axiosGet.resolves(ipApiResponse());
      dbHelperStub.findOneInDatabase.resolves({
        geolocation: { ip: '185.199.108.1' },
        staticIp: false,
        dataCenter: false,
        lastIpChangeDate: null,
        ipFirstSeenAt: Date.now() - (11 * 24 * 60 * 60 * 1000),
        staticIpState: 'UNKNOWN',
        networkClassification: null,
      });
      geolocationService = reload();
      await geolocationService.getNodeGeolocation();

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.getStaticIpState()).to.equal('STATIC');
      expect(geolocationService.isStaticIP()).to.equal(true);
    });

    it('is DYNAMIC behind NAT no matter who the operator is', async () => {
      // The old list applied on this branch too, so a box behind consumer NAT
      // could claim a static address because its registrant string said "ovh".
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(false);
      serviceHelperStub.axiosGet.resolves(ipApiResponse({ org: 'OVH SAS', isp: 'OVH SAS' }));
      dbHelperStub.findOneInDatabase.resolves({
        geolocation: { ip: '185.199.108.1' },
        staticIp: false,
        dataCenter: false,
        lastIpChangeDate: null,
        ipFirstSeenAt: Date.now() - (400 * 24 * 60 * 60 * 1000),
        staticIpState: 'STATIC',
        networkClassification: null,
      });
      geolocationService = reload();
      await geolocationService.getNodeGeolocation();

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.getStaticIpState()).to.equal('DYNAMIC');
      expect(geolocationService.isStaticIP()).to.equal(false);
    });

    it('a known hosting operator confers nothing on its own', async () => {
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(false);
      serviceHelperStub.axiosGet.resolves(ipApiResponse({ org: 'Contabo GmbH', isp: 'Contabo GmbH' }));
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.isStaticIP()).to.equal(false);
    });

    it('restarts the observation when the address changes', async () => {
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(true);
      dbHelperStub.findOneInDatabase.resolves({
        geolocation: { ip: '185.199.108.1' },
        staticIp: true,
        dataCenter: false,
        lastIpChangeDate: null,
        ipFirstSeenAt: Date.now() - (400 * 24 * 60 * 60 * 1000),
        staticIpState: 'STATIC',
        networkClassification: null,
      });
      geolocationService = reload();
      await geolocationService.getNodeGeolocation();
      serviceHelperStub.axiosGet.resolves(ipApiResponse({ query: '185.199.109.9' }));

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.getStaticIpState()).to.equal('UNKNOWN');
    });
  });

  describe('the published table decides, the node falls back', () => {
    let ipLocationStoreStub;

    function reload() {
      return proxyquire('../../ZelBack/src/services/geolocationService', {
        config: configStub,
        '../lib/log': logStub,
        './dbHelper': dbHelperStub,
        './serviceHelper': serviceHelperStub,
        './fluxNetworkHelper': fluxNetworkHelperStub,
        './appPlacement/ipLocationStore': ipLocationStoreStub,
      });
    }

    beforeEach(() => {
      fluxNetworkHelperStub.getLocalSocketAddress.resolves('185.199.108.1:16127');
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(true);
      dbHelperStub.findOneInDatabase.resolves(null);
      // `status().ready` is what separates "the table holds no verdict for this
      // address" from "no table has been ingested". Only the first is an
      // abstention the node may decide for itself.
      ipLocationStoreStub = {
        lookup: sinon.stub().resolves(null),
        status: sinon.stub().returns({ ready: true, generated: 'x', rowCount: 2000000 }),
      };
      // On its own evidence this address is a data centre: a hosting operator
      // and nothing suggesting an access network.
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success',
          query: '185.199.108.1',
          org: 'X',
          isp: 'Hetzner Online GmbH',
          as: 'AS24940 Hetzner Online GmbH',
          proxy: false,
          hosting: false,
        },
      });
    });

    it('takes the published verdict over what the node would have decided', async () => {
      // Local evidence that does not CONTRADICT residential: the table's verdict
      // stands even though the node itself would have said nothing.
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success', query: '185.199.108.1', org: 'X', isp: 'Some Regional ISP',
          as: 'AS64500 Some Regional ISP', proxy: false, hosting: false,
        },
      });
      ipLocationStoreStub.lookup.resolves({ org: 'a1b2c3d4e5f6', networkClass: 'RESIDENTIAL' });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      const verdict = await geolocationService.getNetworkClassification();
      expect(verdict.classification).to.equal('RESIDENTIAL');
      expect(verdict.source).to.equal('published-table');
    });

    it('declines a published RESIDENTIAL when this address contradicts it', async () => {
      // An organisation is published on a strong majority of its hosts, so a
      // minority of its addresses may be the other kind. This is how one of them
      // steps out of a verdict meant for its neighbours - 213.44.137.57 on
      // Bouygues is the live instance.
      ipLocationStoreStub.lookup.resolves({ org: 'a1b2c3d4e5f6', networkClass: 'RESIDENTIAL' });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      const verdict = await geolocationService.getNetworkClassification();
      expect(verdict.classification).to.equal('CONFLICTED');
      expect(verdict.source).to.equal('node-veto');
    });

    it('the veto only ever removes enforcement, never imposes it', async () => {
      // Local evidence saying RESIDENTIAL cannot promote a published DATACENTER.
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success', query: '185.199.108.1', org: 'X', isp: 'Consumer ISP',
          as: 'AS64500 Consumer ISP', proxy: false, hosting: false, mobile: true,
        },
      });
      ipLocationStoreStub.lookup.resolves({ org: 'a1b2c3d4e5f6', networkClass: 'DATACENTER' });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      expect((await geolocationService.getNetworkClassification()).classification).to.equal('DATACENTER');
    });

    it('reaches NO verdict when the organisation carries none', async () => {
      // The table decides or nobody does. The node's own rule is the published
      // rule with registration data removed - a node cannot query the RIRs -
      // and its error rate has never been measured, so it does not get to
      // decide the one thing that deletes customer data. Tuning this address
      // means publishing a verdict for it, by hand if the vote cannot reach it:
      // fluxos-network-policy data/orgclass-overrides.json.
      ipLocationStoreStub.lookup.resolves({ org: 'a1b2c3d4e5f6', networkClass: null });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      expect(await geolocationService.getNetworkClassification()).to.equal(null);
    });

    it('reaches NO verdict when no row covers the address', async () => {
      ipLocationStoreStub.lookup.resolves(null);
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      expect(await geolocationService.getNetworkClassification()).to.equal(null);
    });

    it('still gathers the node\'s own evidence, which is what the veto reads', async () => {
      // Removing the fallback removes the node's verdict as an AUTHORITY, not
      // its evidence: evidenceAgainst is what declines a published RESIDENTIAL
      // for an address in the minority tail an 80% vote is designed to outvote.
      ipLocationStoreStub.lookup.resolves({ org: 'a1b2c3d4e5f6', networkClass: 'RESIDENTIAL' });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      const verdict = await geolocationService.getNetworkClassification();
      expect(verdict.classification).to.equal('CONFLICTED');
      expect(verdict.source).to.equal('node-veto');
      expect(verdict.evidenceAgainst.join(' ')).to.contain('Hetzner');
    });

    it('reaches NO verdict when the geolocation source carried no network signals', async () => {
      // The stats.runonflux.io fallback, taken when ip-api answers 200 with an
      // unusable body. It carries location and org and none of
      // hosting/proxy/mobile/isp/asn - fluxstats never asks ip-api for them and
      // its /fluxlocation endpoint projects them away - so evidenceAgainst is
      // empty because nobody looked.
      //
      // That empties the veto too: it fires on local evidence AGAINST, so a
      // published RESIDENTIAL would stand unchallenged on precisely the
      // addresses the veto exists for. The verdict is null either way, whatever
      // the PTR resolves to, so this does not rest on a DNS answer.
      serviceHelperStub.axiosGet.onFirstCall().resolves({ data: { status: 'fail' } });
      serviceHelperStub.axiosGet.onSecondCall().resolves({
        data: {
          status: 'success',
          data: {
            ip: '185.199.108.1',
            continent: 'Europe',
            continentCode: 'EU',
            country: 'France',
            countryCode: 'FR',
            region: 'IDF',
            regionName: 'Ile-de-France',
            lat: 48.8,
            lon: 2.3,
            org: 'Bouygues Telecom',
          },
        },
      });
      ipLocationStoreStub.lookup.resolves({ org: 'a1b2c3d4e5f6', networkClass: 'RESIDENTIAL' });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      expect(await geolocationService.getNetworkClassification()).to.equal(null);
    });

    it('still records WHERE the node is on that path, which is what the fallback is for', async () => {
      // The fix must not cost the fallback its actual job. Country and region
      // feed placement and the region pins; refusing to store them would break
      // location for every node whose ip-api call comes back unusable.
      serviceHelperStub.axiosGet.onFirstCall().resolves({ data: { status: 'fail' } });
      serviceHelperStub.axiosGet.onSecondCall().resolves({
        data: {
          status: 'success',
          data: {
            ip: '185.199.108.1', continent: 'Europe', continentCode: 'EU', country: 'France', countryCode: 'FR', region: 'IDF', regionName: 'Ile-de-France', lat: 48.8, lon: 2.3, org: 'Bouygues Telecom',
          },
        },
      });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      const where = await geolocationService.getNodeGeolocation();
      expect(where.country).to.equal('France');
      expect(where.countryCode).to.equal('FR');
      expect(where.regionName).to.equal('Ile-de-France');
    });

    it('reaches NO verdict when the table cannot be read at all', async () => {
      // A table that could not be read was not consulted, and a node that has
      // not consulted it does not know what kind of network it is on. Falling
      // back here would be treating "I could not ask" as "there is no answer" -
      // the same mistake, one level up, that the classifier exists to avoid.
      ipLocationStoreStub.lookup.rejects(new Error('no database connection'));
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      expect(await geolocationService.getNetworkClassification()).to.equal(null);
    });

    it('reaches NO verdict until a baseline has been ingested', async () => {
      // The state every node boots into: the artifact is 4.6 MB and two million
      // rows, an ip-api call answers in milliseconds, so the table is reliably
      // absent at the moment a booting node would otherwise decide. Nothing
      // enforces on null, which is the point.
      ipLocationStoreStub.status.returns({ ready: false, generated: null, rowCount: 0 });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      expect(await geolocationService.getNetworkClassification()).to.equal(null);
      sinon.assert.notCalled(ipLocationStoreStub.lookup);
    });

    it('reaches the verdict again once the baseline lands, without re-gathering', async () => {
      // The evidence is gathered once and is expensive; the table arrives later
      // and is cheap to consult. Asking again is what picks the table up - there
      // is no second ip-api call and no stored verdict to go stale.
      ipLocationStoreStub.status.returns({ ready: false, generated: null, rowCount: 0 });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();
      expect(await geolocationService.getNetworkClassification()).to.equal(null);
      const gatherCalls = serviceHelperStub.axiosGet.callCount;

      ipLocationStoreStub.status.returns({ ready: true, generated: 'x', rowCount: 2000000 });
      ipLocationStoreStub.lookup.resolves({ org: 'a1b2c3d4e5f6', networkClass: 'DATACENTER' });

      const verdict = await geolocationService.getNetworkClassification();
      expect(verdict.classification).to.equal('DATACENTER');
      expect(verdict.source).to.equal('published-table');
      expect(serviceHelperStub.axiosGet.callCount).to.equal(gatherCalls);
    });

    it('still records the node\'s own evidence when the table decided', async () => {
      // The published verdict is the answer; the local evidence stays visible so
      // a disagreement between the two is diagnosable rather than invisible.
      ipLocationStoreStub.lookup.resolves({ org: 'a1b2c3d4e5f6', networkClass: 'RESIDENTIAL' });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      const verdict = await geolocationService.getNetworkClassification();
      expect(verdict.evidenceAgainst.join(' ')).to.contain('Hetzner');
    });

    it('drives isDataCenter from the node\'s own reading, not the table', async () => {
      // isDataCenter() is synchronous and predates all of this; it stays what
      // this node observed about itself. The published verdict is reached
      // through getNetworkClassification, which is the one enforcement reads.
      ipLocationStoreStub.lookup.resolves({ org: 'a1b2c3d4e5f6', networkClass: 'DATACENTER' });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.isDataCenter()).to.equal(true);
    });
  });

  describe('network classification', () => {
    // These are about the EVIDENCE the node gathers about itself and what rides
    // on it - not about who decides. The table decides; a table holding no
    // verdict means the node is simply not classified, so the default here is
    // one that has decided DATACENTER and the tests that care about an
    // abstention set it to null themselves.
    let tableStub;

    function reload() {
      return proxyquire('../../ZelBack/src/services/geolocationService', {
        config: configStub,
        '../lib/log': logStub,
        './dbHelper': dbHelperStub,
        './serviceHelper': serviceHelperStub,
        './fluxNetworkHelper': fluxNetworkHelperStub,
        './appPlacement/ipLocationStore': tableStub,
      });
    }

    beforeEach(() => {
      fluxNetworkHelperStub.getLocalSocketAddress.resolves('185.199.108.1:16127');
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(true);
      dbHelperStub.findOneInDatabase.resolves(null);
      tableStub = {
        lookup: sinon.stub().resolves({ org: 'a1b2c3d4e5f6', networkClass: 'DATACENTER' }),
        status: sinon.stub().returns({ ready: true, generated: 'x', rowCount: 2000000 }),
      };
    });

    it('has nothing to say before anything has been gathered', async () => {
      geolocationService = reload();

      expect(await geolocationService.getNetworkClassification()).to.equal(null);
    });

    it('asks ip-api for the operator AS, not just the registrant org', async () => {
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success', query: '185.199.108.1', org: 'X', isp: 'X', as: 'AS1 X', hosting: false, proxy: false,
        },
      });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      expect(serviceHelperStub.axiosGet.firstCall.args[0]).to.include('as');
      expect(serviceHelperStub.axiosGet.firstCall.args[0]).to.include('mobile');
    });

    it('publishes the verdict with the evidence behind it', async () => {
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success',
          query: '185.199.108.1',
          org: 'Yorkshire Tech Limited',
          isp: 'Contabo Asia Private Limited',
          as: 'AS141995 Contabo Asia Private Limited',
          proxy: false,
          hosting: false,
        },
      });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      const verdict = await geolocationService.getNetworkClassification();
      expect(verdict.classification).to.equal('DATACENTER');
      expect(verdict.evidenceAgainst.join(' ')).to.contain('Contabo');
      expect(verdict.gatheredAt).to.be.a('number');
    });

    it('drives isDataCenter from the verdict', async () => {
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success', query: '185.199.108.1', org: 'X', isp: 'X', as: 'AS1 X', hosting: true, proxy: false,
        },
      });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      expect(geolocationService.isDataCenter()).to.equal(true);
    });

    it('leaves isDataCenter false on a verdict of UNKNOWN', async () => {
      // Absence of evidence is not evidence of a data centre - nor of anything.
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success',
          query: '185.199.108.1',
          org: 'Some Regional ISP',
          isp: 'Some Regional ISP',
          as: 'AS64500 Some Regional ISP',
          proxy: false,
          hosting: false,
        },
      });
      geolocationService = reload();

      await geolocationService.setNodeGeolocation();

      // isDataCenter reads the node's own classification directly and is not a
      // verdict about enforcement, so it answers whether or not the table has
      // decided - and absence of evidence leaves it false.
      expect(geolocationService.isDataCenter()).to.equal(false);
    });
  });

  describe('Database storage tests', () => {
    beforeEach(() => {
      fluxNetworkHelperStub.getLocalSocketAddress.resolves('185.199.108.1:16127');
      fluxNetworkHelperStub.hasPublicIpOnInterface.resolves(false);
      serviceHelperStub.axiosGet.resolves({
        data: {
          status: 'success',
          query: '185.199.108.1',
          org: 'Test',
          proxy: false,
          hosting: false,
        },
      });
    });

    it('should not store to db when connection is unavailable', async () => {
      dbHelperStub.databaseConnection.returns(null);

      await geolocationService.setNodeGeolocation();

      sinon.assert.calledWith(logStub.warn, 'Database connection not available for storing geolocation');
    });

    it('should handle db storage error gracefully', async () => {
      dbHelperStub.updateOneInDatabase.rejects(new Error('DB write error'));

      await geolocationService.setNodeGeolocation();

      sinon.assert.calledWithMatch(logStub.error, /Failed to store geolocation to database/);
    });
  });
});
