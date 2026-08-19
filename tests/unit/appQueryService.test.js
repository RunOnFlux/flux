const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appQueryService tests', () => {
  let appQueryService;
  let dbHelperStub;
  let messageHelperStub;
  let dockerServiceStub;
  let registryManagerStub;
  let enterpriseHelperStub;
  let appSpecHelpersStub;
  let cacheManagerStub;
  let logStub;
  let configStub;

  beforeEach(() => {
    // Config stub
    configStub = {
      database: {
        daemon: {
          collections: {
            scannedHeight: 'scannedHeight',
            appsHashes: 'appsHashes',
          },
        },
        appslocal: {
          collections: {
            appsInformation: 'localAppsInformation',
          },
          database: 'localapps',
        },
        appsglobal: {
          collections: {
            appsMessages: 'appsMessages',
            appsInformation: 'globalAppsInformation',
            appsTemporaryMessages: 'appsTemporaryMessages',
            appsLocations: 'appsLocations',
            appsInstallingLocations: 'appsInstallingLocations',
            appsInstallingErrorsLocations: 'appsInstallingErrorsLocations',
          },
          database: 'globalapps',
        },
      },
      fluxapps: {
        latestAppSpecification: 1,
      },
    };

    // Stubs
    dbHelperStub = {
      databaseConnection: sinon.stub(),
      findInDatabase: sinon.stub(),
      findOneInDatabase: sinon.stub(),
    };

    messageHelperStub = {
      createDataMessage: sinon.stub(),
      createErrorMessage: sinon.stub(),
    };

    dockerServiceStub = {
      dockerListContainers: sinon.stub(),
      // Mirrors the real predicate rather than returning a constant: these
      // tests assert which containers survive the filter, so a stub that
      // waved everything through would stop testing anything. The real one
      // is pinned by its own cases in dockerService.test.js.
      isAppContainer: (container) => {
        const role = container.Labels && container.Labels['runonflux.role'];
        if (role) return role === 'app';
        const name = (container.Names && container.Names[0]) || '';
        return name.slice(1, 4) === 'zel' || name.slice(1, 5) === 'flux';
      },
      // Namespacing, for the same reason: heldComponents is compared against a
      // docker name by the peer that reads it, so an identity stub would hide a
      // missing prefix and pass on an answer no caller could match.
      getAppIdentifier: (appName) => (appName.startsWith('zel') || appName.startsWith('flux') ? appName : `flux${appName}`),
    };

    registryManagerStub = {
      appLocation: sinon.stub(),
      appInstallingLocation: sinon.stub(),
    };

    enterpriseHelperStub = {
      checkAndDecryptAppSpecs: sinon.stub().returnsArg(0), // Return app as-is by default
    };

    appSpecHelpersStub = {
      specificationFormatter: sinon.stub().returnsArg(0), // Return app as-is by default
    };

    cacheManagerStub = {
      default: {
        enterpriseAppDecryptionCache: {
          get: sinon.stub().returns(null), // By default, cache misses
          set: sinon.stub(),
        },
      },
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    // Proxy require
    appQueryService = proxyquire('../../ZelBack/src/services/appQuery/appQueryService', {
      config: configStub,
      '../dbHelper': dbHelperStub,
      '../messageHelper': messageHelperStub,
      '../dockerService': dockerServiceStub,
      '../appDatabase/registryManager': registryManagerStub,
      '../utils/enterpriseHelper': enterpriseHelperStub,
      '../utils/appSpecHelpers': appSpecHelpersStub,
      '../utils/cacheManager': cacheManagerStub,
      '../../lib/log': logStub,
      '../utils/appConstants': proxyquire('../../ZelBack/src/services/utils/appConstants', {
        config: configStub,
      }),
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('decryptEnterpriseApps', () => {
    const enterpriseApp = {
      name: 'entApp', version: 8, enterprise: 'CIPHERTEXT', hash: 'h1',
    };

    it('returns non-enterprise apps unchanged without decrypting', async () => {
      const apps = [{ name: 'plain', version: 4 }];
      const result = await appQueryService.decryptEnterpriseApps(apps, { formatSpecs: false });
      expect(result.readable).to.deep.equal(apps);
      expect(result.unreadable).to.deep.equal([]);
      expect(enterpriseHelperStub.checkAndDecryptAppSpecs.called).to.be.false;
    });

    // A spec that did not decrypt has no components, and an app with no
    // components is not a valid app. Reporting it separately is what stops a
    // caller reading "owns no folders" / "has no images" and acting on it.
    it('reports a spec it could not decrypt instead of returning it as an app', async () => {
      // resetBehavior first: a stub's returnsArg(0) (set in beforeEach) otherwise wins over rejects()
      enterpriseHelperStub.checkAndDecryptAppSpecs.resetBehavior();
      enterpriseHelperStub.checkAndDecryptAppSpecs.rejects(new Error('enterpriseKey is mandatory'));

      const result = await appQueryService.decryptEnterpriseApps([enterpriseApp], { formatSpecs: false });

      expect(result.readable).to.deep.equal([]);
      expect(result.unreadable).to.deep.equal([enterpriseApp]);
    });

    it('keeps the readable apps when one of several cannot be decrypted', async () => {
      const plain = { name: 'plain', version: 4 };
      enterpriseHelperStub.checkAndDecryptAppSpecs.resetBehavior();
      enterpriseHelperStub.checkAndDecryptAppSpecs.rejects(new Error('enterpriseKey is mandatory'));

      const result = await appQueryService.decryptEnterpriseApps([plain, enterpriseApp], { formatSpecs: false });

      expect(result.readable).to.deep.equal([plain]);
      expect(result.unreadable).to.deep.equal([enterpriseApp]);
    });

    // listing callers want the app to still appear, in the position it was in
    it('puts an undecryptable spec back in place for listing', async () => {
      const first = { name: 'first', version: 4 };
      const last = { name: 'last', version: 4 };
      enterpriseHelperStub.checkAndDecryptAppSpecs.resetBehavior();
      enterpriseHelperStub.checkAndDecryptAppSpecs.rejects(new Error('enterpriseKey is mandatory'));

      const { inPlace, readable, unreadable } = await appQueryService.decryptEnterpriseApps(
        [first, enterpriseApp, last], { formatSpecs: false },
      );

      // inPlace keeps the caller's order with the unreadable spec where it was;
      // readable is the same list minus it, so an acting caller cannot be handed
      // a spec whose components are still inside the blob
      expect(inPlace).to.deep.equal([first, enterpriseApp, last]);
      expect(readable).to.deep.equal([first, last]);
      expect(unreadable).to.deep.equal([enterpriseApp]);
    });

    // Call-volume contract: with many components in defer loops, benchd must
    // not be hammered. Concurrent decrypts of the same spec share one in-flight
    // attempt, and a failure is remembered briefly so retries inside the window
    // are answered from the failure cache (lenient callers get the encrypted
    // spec back, strict callers get the rethrow) - one benchd attempt per app
    // per window, regardless of component count. Successes are unaffected.
    describe('benchd call volume under failure', () => {
      it('shares one in-flight decryption across concurrent callers of the same spec', async () => {
        const decrypted = { ...enterpriseApp, compose: [{ name: 'c1' }] };
        let release;
        const gate = new Promise((res) => { release = res; });
        enterpriseHelperStub.checkAndDecryptAppSpecs.resetBehavior();
        enterpriseHelperStub.checkAndDecryptAppSpecs.callsFake(async () => {
          await gate;
          return decrypted;
        });

        const p1 = appQueryService.decryptEnterpriseApps([enterpriseApp], { formatSpecs: false });
        const p2 = appQueryService.decryptEnterpriseApps([enterpriseApp], { formatSpecs: false });
        release();
        const [r1, r2] = await Promise.all([p1, p2]);

        expect(enterpriseHelperStub.checkAndDecryptAppSpecs.callCount, 'concurrent callers must share one benchd attempt').to.equal(1);
        expect(r1.readable[0].compose).to.have.lengthOf(1);
        expect(r2.readable[0].compose).to.have.lengthOf(1);
      });

      it('remembers a decryption failure briefly - retries inside the window skip benchd', async () => {
        enterpriseHelperStub.checkAndDecryptAppSpecs.resetBehavior();
        enterpriseHelperStub.checkAndDecryptAppSpecs.rejects(new Error('benchd unavailable'));
        const clock = sinon.useFakeTimers();
        try {
          await appQueryService.decryptEnterpriseApps([enterpriseApp], { formatSpecs: false });
          await appQueryService.decryptEnterpriseApps([enterpriseApp], { formatSpecs: false });
          expect(enterpriseHelperStub.checkAndDecryptAppSpecs.callCount, 'second call inside the window must not hit benchd').to.equal(1);

          clock.tick(61 * 1000); // past the failure window - benchd may have recovered
          await appQueryService.decryptEnterpriseApps([enterpriseApp], { formatSpecs: false });
          expect(enterpriseHelperStub.checkAndDecryptAppSpecs.callCount, 'after the window the decrypt is retried').to.equal(2);
        } finally {
          clock.restore();
        }
      });

      it('a remembered failure answers the next caller without another benchd call', async () => {
        enterpriseHelperStub.checkAndDecryptAppSpecs.resetBehavior();
        enterpriseHelperStub.checkAndDecryptAppSpecs.rejects(new Error('benchd unavailable'));

        await appQueryService.decryptEnterpriseApps([enterpriseApp], { formatSpecs: false }); // seeds the failure window
        const again = await appQueryService.decryptEnterpriseApps([enterpriseApp], { formatSpecs: false });

        expect(again.unreadable, 'the spec is still reported unreadable').to.deep.equal([enterpriseApp]);
        expect(enterpriseHelperStub.checkAndDecryptAppSpecs.callCount, 'the cached failure answers without re-hitting benchd').to.equal(1);
      });
    });
  });

  describe('installedApps', () => {
    it('should return installed apps from database', async () => {
      const mockApps = [
        { name: 'app1', version: 4 },
        { name: 'app2', version: 3 },
      ];
      const mockDb = {
        db: sinon.stub().returns('appsDatabase'),
      };

      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.resolves(mockApps);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: mockApps });

      const result = await appQueryService.installedApps();

      expect(result).to.deep.equal({ status: 'success', data: mockApps });
      expect(dbHelperStub.findInDatabase.calledOnce).to.be.true;
      expect(messageHelperStub.createDataMessage.calledWith(mockApps)).to.be.true;
    });

    it('should return installed apps with specific appname from query', async () => {
      const mockApp = { name: 'app1', version: 4 };
      const mockDb = {
        db: sinon.stub().returns('appsDatabase'),
      };
      const req = {
        params: { appname: 'app1' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.resolves([mockApp]);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: [mockApp] });

      await appQueryService.installedApps(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(dbHelperStub.findInDatabase.calledOnce).to.be.true;
    });

    it('should handle string parameter for appname', async () => {
      const mockApp = [{ name: 'app1', version: 4 }];
      const mockDb = {
        db: sinon.stub().returns('appsDatabase'),
      };

      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.resolves(mockApp);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: mockApp });

      const result = await appQueryService.installedApps('app1');

      expect(result).to.deep.equal({ status: 'success', data: mockApp });
      expect(dbHelperStub.findInDatabase.calledOnce).to.be.true;
    });

    it('should return error message on database failure', async () => {
      const mockDb = {
        db: sinon.stub().returns('appsDatabase'),
      };
      const error = new Error('Database error');

      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.rejects(error);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'Database error' } });

      const result = await appQueryService.installedApps();

      expect(result.status).to.equal('error');
      expect(messageHelperStub.createErrorMessage.calledOnce).to.be.true;
      expect(logStub.error.calledWith(error)).to.be.true;
    });

    it('should return apps data with response passed', async () => {
      const mockApps = [
        { name: 'app1', version: 4 },
        { name: 'app2', version: 3 },
      ];
      const mockDb = {
        db: sinon.stub().returns('appsDatabase'),
      };
      const res = {
        json: sinon.stub(),
      };
      const req = {
        params: { appname: 'appName' },
        query: {},
      };

      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.resolves(mockApps);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: mockApps });

      await appQueryService.installedApps(req, res);

      expect(res.json.calledOnceWith({ status: 'success', data: mockApps })).to.be.true;
    });

    it('should return error with response passed on database failure', async () => {
      const mockDb = {
        db: sinon.stub().returns('appsDatabase'),
      };
      const error = new Error('Database error');
      const res = {
        json: sinon.stub(),
      };
      const req = 'appName';

      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.rejects(error);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'Database error' } });

      await appQueryService.installedApps(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.calledWith(error)).to.be.true;
    });
  });

  describe('listRunningApps', () => {
    it('should return running flux apps', async () => {
      const mockContainers = [
        {
          Names: ['/flux_app1'], HostConfig: {}, NetworkSettings: {}, Mounts: [],
        },
        {
          Names: ['/zel_app2'], HostConfig: {}, NetworkSettings: {}, Mounts: [],
        },
        {
          Names: ['/other_app'], HostConfig: {}, NetworkSettings: {}, Mounts: [],
        },
      ];
      const expectedApps = [
        { Names: ['/flux_app1'] },
        { Names: ['/zel_app2'] },
      ];

      dockerServiceStub.dockerListContainers.resolves(mockContainers);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: expectedApps });

      const result = await appQueryService.listRunningApps();

      expect(result).to.deep.equal({ status: 'success', data: expectedApps });
      expect(dockerServiceStub.dockerListContainers.calledWith(false)).to.be.true;
    });

    it('should return empty array when no flux apps are running', async () => {
      dockerServiceStub.dockerListContainers.resolves([]);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: [] });

      const result = await appQueryService.listRunningApps();

      expect(result).to.deep.equal({ status: 'success', data: [] });
    });

    it('should handle docker service errors', async () => {
      const error = new Error('Docker error');

      dockerServiceStub.dockerListContainers.rejects(error);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'Docker error' } });

      const result = await appQueryService.listRunningApps();

      expect(result.status).to.equal('error');
      expect(logStub.error.calledWith(error)).to.be.true;
    });

    // listRunningApps must report an app under backup/restore as running even
    // though its container is deliberately stopped, so the network (FDM, peers)
    // does not react to the stop. The lease arrays hold bare MAIN APP names
    // (exactly as appendBackupTask writes them); container names are component
    // identifiers - the lookup must compare the main app name.
    it('includes a stopped container of an app under backup as running', async () => {
      // appQueryService lazy-requires globalState at call time, so proxyquire
      // does not intercept it - manipulate the real singleton and clean up.
      // eslint-disable-next-line global-require
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.backupInProgress.push('App'); // bare main-app name (production format)
      try {
        const stoppedContainer = {
          Names: ['/fluxwww_App'], State: 'exited', HostConfig: {}, NetworkSettings: {}, Mounts: [],
        };
        dockerServiceStub.dockerListContainers.withArgs(false).resolves([]); // nothing running
        dockerServiceStub.dockerListContainers.withArgs(true).resolves([stoppedContainer]);
        messageHelperStub.createDataMessage.callsFake((data) => ({ status: 'success', data }));

        const result = await appQueryService.listRunningApps();

        expect(result.status).to.equal('success');
        const names = result.data.map((app) => app.Names[0]);
        expect(names, 'backed-up app must still be reported as running').to.include('/fluxwww_App');
      } finally {
        globalState.backupInProgress.length = 0;
      }
    });

    it('should return running apps with response passed', async () => {
      const mockContainers = [
        {
          Names: ['/flux_app1'], HostConfig: {}, NetworkSettings: {}, Mounts: [],
        },
        {
          Names: ['/zel_app2'], HostConfig: {}, NetworkSettings: {}, Mounts: [],
        },
      ];
      const expectedApps = [
        { Names: ['/flux_app1'] },
        { Names: ['/zel_app2'] },
      ];
      const res = {
        json: sinon.stub(),
      };

      dockerServiceStub.dockerListContainers.resolves(mockContainers);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: expectedApps });

      await appQueryService.listRunningApps(undefined, res);

      expect(res.json.calledOnceWith({ status: 'success', data: expectedApps })).to.be.true;
    });
  });

  describe('heldComponents', () => {
    // What a peer mid-election is told this node owns. Answering short here is not
    // a stale reading - it is a second container started on a volume this node is
    // already writing, which corrupts it.
    // eslint-disable-next-line global-require
    const appsRuntimeState = require('../../ZelBack/src/services/appManagement/appsRuntimeState');
    // eslint-disable-next-line global-require
    const appReconciler = require('../../ZelBack/src/services/appMonitoring/appReconciler');

    // The three sources, each independently switchable, because the point of every
    // case below is which one carried the answer.
    const held = async ({ running = [], committed = [], stopped = [] } = {}) => {
      dockerServiceStub.dockerListContainers.resolves(running.map((name) => ({ Names: [`/${name}`] })));
      sinon.stub(appReconciler, 'committedIdentifiers').returns(committed);
      sinon.stub(appsRuntimeState, 'operatorStoppedIdentifiers').resolves(stopped);
      messageHelperStub.createDataMessage.returnsArg(0);
      return appQueryService.heldComponents();
    };

    it('reports a component the operator stopped, with no container and nothing committed', async () => {
      // The regression. `appstop` is durable and node-local: the election skips
      // this node and the reconciler leaves the container down. Before this, none
      // of that reached a peer - it saw no container, no commitment, and elected a
      // new primary over an owner who had stopped theirs to work on it.
      const result = await held({ stopped: ['www_App'] });

      expect(result).to.deep.equal(['fluxwww_App']);
    });

    it('namespaces a stopped identifier the way the caller asks about it', async () => {
      // The lock store is keyed on the bare identifier and the election compares
      // against the docker name, so an unprefixed entry would never match and the
      // hold would silently do nothing.
      const result = await held({ stopped: ['www_App', 'zelKadena'] });

      expect(result).to.deep.equal(['fluxwww_App', 'zelKadena']);
    });

    it('unions the three sources and reports each component once', async () => {
      const result = await held({
        running: ['fluxwww_App'],
        committed: ['www_App'],
        stopped: ['www_App'],
      });

      expect(result).to.deep.equal(['fluxwww_App']);
    });

    it('still reports a running container that carries no lock and no commitment', async () => {
      const result = await held({ running: ['fluxapi_App'] });

      expect(result).to.deep.equal(['fluxapi_App']);
    });

    it('holds nothing when the node holds nothing', async () => {
      expect(await held()).to.deep.equal([]);
    });

    it('fails the request when the lock store cannot be read, rather than answering short', async () => {
      // A peer reads a short answer as "free". Both failure directions have to land
      // in the error path so the caller sees a node that could not answer, not a
      // node that answered nothing.
      dockerServiceStub.dockerListContainers.resolves([{ Names: ['/fluxwww_App'] }]);
      sinon.stub(appReconciler, 'committedIdentifiers').returns([]);
      sinon.stub(appsRuntimeState, 'operatorStoppedIdentifiers').rejects(new Error('no primary available'));
      messageHelperStub.createErrorMessage.returns({ status: 'error' });

      const result = await appQueryService.heldComponents();

      expect(result).to.deep.equal({ status: 'error' });
      expect(messageHelperStub.createDataMessage.called, 'answered with a list built from a failed read').to.be.false;
    });
  });

  describe('promotedFolders', () => {
    // eslint-disable-next-line global-require
    const globalState = require('../../ZelBack/src/services/utils/globalState');

    afterEach(() => {
      globalState.promotedFolderIds = new Set();
    });

    it('reports the folders this node holds writable, from the monitor set', async () => {
      globalState.promotedFolderIds = new Set(['fluxa_a', 'fluxb_b']);
      messageHelperStub.createDataMessage.returnsArg(0);

      const result = await appQueryService.promotedFolders();

      expect(result).to.deep.equal({ ready: true, folders: ['fluxa_a', 'fluxb_b'] });
    });

    it('answers not-ready before the monitor has ever read the folder config', async () => {
      // The state that made this necessary: holding nothing and not having looked
      // are the same empty set but opposite answers, and a booting node that IS
      // holding a folder would otherwise read as free and be promoted alongside.
      globalState.promotedFolderIds = null;
      messageHelperStub.createDataMessage.returnsArg(0);

      const result = await appQueryService.promotedFolders();

      expect(result).to.deep.equal({ ready: false, folders: [] });
    });

    it('distinguishes holding nothing from not having looked', async () => {
      globalState.promotedFolderIds = new Set();
      messageHelperStub.createDataMessage.returnsArg(0);

      const result = await appQueryService.promotedFolders();

      expect(result.folders).to.deep.equal([]);
      expect(result.ready, 'an empty set after a real read is a genuine answer').to.equal(true);
    });

    it('touches no backend, so an anonymous caller cannot amplify into syncthing', async () => {
      // The route is unauthenticated and the API has no rate limiting, so this
      // must answer from memory rather than reading syncthing per request.
      globalState.promotedFolderIds = new Set(['fluxa_a']);
      messageHelperStub.createDataMessage.returnsArg(0);

      await appQueryService.promotedFolders();

      expect(dockerServiceStub.dockerListContainers.called).to.be.false;
    });

    it('drops a folder that is no longer promoted', async () => {
      // The monitor replaces the set wholesale from the folder config each pass, so
      // a demotion or an uninstall leaves by simply not being rebuilt - there is no
      // separate removal path that could be missed.
      globalState.promotedFolderIds = new Set(['fluxa_a', 'fluxb_b']);
      messageHelperStub.createDataMessage.returnsArg(0);

      globalState.promotedFolderIds = new Set(['fluxa_a']); // b demoted to receiveonly
      const result = await appQueryService.promotedFolders();

      expect(result.folders).to.deep.equal(['fluxa_a']);
    });
  });

  describe('listAllApps', () => {
    it('should return all flux apps including stopped ones', async () => {
      const mockContainers = [
        {
          Names: ['/flux_app1'], HostConfig: {}, NetworkSettings: {}, Mounts: [], State: 'running',
        },
        {
          Names: ['/flux_app2'], HostConfig: {}, NetworkSettings: {}, Mounts: [], State: 'exited',
        },
      ];
      const expectedApps = [
        { Names: ['/flux_app1'], State: 'running' },
        { Names: ['/flux_app2'], State: 'exited' },
      ];

      dockerServiceStub.dockerListContainers.resolves(mockContainers);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: expectedApps });

      const result = await appQueryService.listAllApps();

      expect(result).to.deep.equal({ status: 'success', data: expectedApps });
      expect(dockerServiceStub.dockerListContainers.calledWith(true)).to.be.true;
    });

    it('should return error if dockerService throws, no response passed', async () => {
      const error = new Error('Docker error');

      dockerServiceStub.dockerListContainers.rejects(error);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'Docker error' } });

      const result = await appQueryService.listAllApps();

      expect(result.status).to.equal('error');
      expect(logStub.error.calledWith(error)).to.be.true;
    });

    it('should return error if dockerService throws, response passed', async () => {
      const res = {
        json: sinon.stub(),
      };
      const error = new Error('Docker error');

      dockerServiceStub.dockerListContainers.rejects(error);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'Docker error' } });

      await appQueryService.listAllApps(undefined, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.calledWith(error)).to.be.true;
    });

    it('should return all apps with response passed', async () => {
      const mockContainers = [
        {
          Names: ['/flux_app1'], HostConfig: {}, NetworkSettings: {}, Mounts: [], State: 'running',
        },
        {
          Names: ['/flux_app2'], HostConfig: {}, NetworkSettings: {}, Mounts: [], State: 'exited',
        },
      ];
      const expectedApps = [
        { Names: ['/flux_app1'], State: 'running' },
        { Names: ['/flux_app2'], State: 'exited' },
      ];
      const res = {
        json: sinon.stub(),
      };

      dockerServiceStub.dockerListContainers.resolves(mockContainers);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: expectedApps });

      await appQueryService.listAllApps(undefined, res);

      expect(res.json.calledOnceWith({ status: 'success', data: expectedApps })).to.be.true;
    });
  });

  describe('getlatestApplicationSpecificationAPI', () => {
    it('should return latest app specification version', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createDataMessage.returns({ status: 'success', data: 1 });

      await appQueryService.getlatestApplicationSpecificationAPI(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.createDataMessage.calledOnce).to.be.true;
    });
  });

  describe('getApplicationOriginalOwner', () => {
    it('should return app owner from permanent messages', async () => {
      const req = {
        params: { appname: 'testapp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };
      const mockMessages = [
        { appSpecifications: { owner: 'owner1', name: 'testapp' }, height: 100 },
        { appSpecifications: { owner: 'owner2', name: 'testapp' }, height: 200 },
      ];
      const mockDb = {
        db: sinon.stub().returns('appsDatabase'),
      };

      dbHelperStub.databaseConnection.returns(mockDb);
      dbHelperStub.findInDatabase.resolves(mockMessages);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: 'owner2' });

      await appQueryService.getApplicationOriginalOwner(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(dbHelperStub.findInDatabase.calledOnce).to.be.true;
    });

    it('should handle missing appname parameter', async () => {
      const req = {
        params: {},
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'No Application Name specified' } });

      await appQueryService.getApplicationOriginalOwner(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.createErrorMessage.calledOnce).to.be.true;
    });
  });

  describe('getAppsInstallingLocations', () => {
    it('should return apps installing locations', async () => {
      const mockLocations = [
        { name: 'app1', ip: '192.168.1.1' },
        { name: 'app2', ip: '192.168.1.2' },
      ];
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      registryManagerStub.appInstallingLocation.resolves(mockLocations);
      messageHelperStub.createDataMessage.returns({ status: 'success', data: mockLocations });

      await appQueryService.getAppsInstallingLocations(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(registryManagerStub.appInstallingLocation.calledOnce).to.be.true;
    });

    it('should handle registry manager errors', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };
      const error = new Error('Registry error');

      registryManagerStub.appInstallingLocation.rejects(error);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'Registry error' } });

      await appQueryService.getAppsInstallingLocations(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(logStub.error.calledWith(error)).to.be.true;
    });
  });
});
