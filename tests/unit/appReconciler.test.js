const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appReconciler tests', () => {
  let appReconciler;
  let stubs;
  let localSpec; // the app spec getLocalComponentSpec will resolve

  beforeEach(() => {
    localSpec = {
      name: 'App', version: 4, compose: [{ name: 'www', containerData: '/data' }],
    };

    stubs = {
      log: { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      dbHelper: {
        databaseConnection: () => ({ db: () => ({}) }),
        findOneInDatabase: sinon.stub().callsFake(async () => localSpec),
      },
      dockerService: {
        dockerContainerInspect: sinon.stub().resolves({ State: { Running: false, Status: 'exited', ExitCode: 1 } }),
        // reachability probe used by dockerActual on an inspect failure; resolves => docker up
        dockerListContainers: sinon.stub().resolves([]),
        // final existence re-check before the remove-on-recreate-failure fallback
        getDockerContainerOnly: sinon.stub().resolves(undefined),
        appDockerStart: sinon.stub().resolves(),
        appDockerStop: sinon.stub().resolves(),
        appDockerForceRemove: sinon.stub().resolves(),
        getAppIdentifier: (id) => `flux${id}`,
        getAppDockerNameIdentifier: (id) => `/flux${id}`,
        getBaseAppName: (id) => (id.startsWith('flux') ? id.slice(4) : id),
        // network-attachment helpers used by dockerActual + the running branch.
        // Default: a benign, attached container (not detached), so the heal path
        // stays dormant unless a test opts in.
        classifyContainerNetworkAttachment: sinon.stub().returns({
          managed: false, running: false, networkMode: null, attached: false,
        }),
        isContainerDetachedFromNetwork: sinon.stub().returns(false),
        dockerNetworkState: sinon.stub().resolves('exists'),
      },
      globalState: {
        appsMonitored: {},
        stoppingContainers: new Set(),
        backupInProgress: [],
        restoreInProgress: [],
        isOperationInProgress: () => false,
        bootContainerStateSettled: true,
        waitForBootContainerStateSettled: () => Promise.resolve(),
      },
      appInspector: { startAppMonitoring: sinon.stub(), stopAppMonitoring: sinon.stub() },
      volumeService: {
        ensureMountPathsExist: sinon.stub().resolves(),
        ensureAppVolumeMounted: sinon.stub().resolves({ mounted: true, alreadyMounted: true }),
        // the heal will not destroy a container whose volume it cannot verify
        verifyAppVolumeMount: sinon.stub().resolves(true),
      },
      appsRuntimeState: {
        isOperatorStopped: sinon.stub().resolves(false),
        restartWaitMs: sinon.stub().resolves(0),
        recordRestart: sinon.stub().resolves(),
        recordExit: sinon.stub().resolves(),
        // durable "I removed this container for a network heal" flag + its own ladder
        isNetworkHealRemoval: sinon.stub().resolves(false),
        setNetworkHealRemoval: sinon.stub().resolves(),
        recordNetworkHealAttempt: sinon.stub().resolves(),
        networkHealWaitMs: sinon.stub().resolves(0),
        clearNetworkHeal: sinon.stub().resolves(),
      },
      appQueryService: {
        decryptEnterpriseApps: sinon.stub().callsFake(async (arr) => arr),
        installedApps: sinon.stub().resolves({ status: 'success', data: [] }),
      },
      containerHealthMonitor: { recreateMissingContainers: sinon.stub().resolves() },
      appUninstaller: { removeAppLocally: sinon.stub().resolves() },
      appTamperingDetectionService: { recordEvent: sinon.stub().resolves(), isNetworkMissingError: () => false },
      dockerOperations: { appDeleteDataInMountPoint: sinon.stub().resolves() },
      serviceHelper: { delay: sinon.stub().resolves() },
    };

    appReconciler = proxyquire('../../ZelBack/src/services/appMonitoring/appReconciler', {
      '../../lib/log': stubs.log,
      '../dbHelper': stubs.dbHelper,
      '../dockerService': stubs.dockerService,
      '../utils/globalState': stubs.globalState,
      '../appManagement/appInspector': stubs.appInspector,
      '../utils/volumeService': stubs.volumeService,
      '../appManagement/appsRuntimeState': stubs.appsRuntimeState,
      '../appQuery/appQueryService': stubs.appQueryService,
      './containerHealthMonitor': stubs.containerHealthMonitor,
      '../appLifecycle/appUninstaller': stubs.appUninstaller,
      '../appTamperingDetectionService': stubs.appTamperingDetectionService,
      '../appManagement/dockerOperations': stubs.dockerOperations,
      '../serviceHelper': stubs.serviceHelper,
      '../utils/appConstants': { localAppsInformation: 'zelappsinformation' },
    });
  });

  afterEach(() => { appReconciler.stop(); sinon.restore(); });

  // resolves exactly when its .resolve() is called — lets tests await the real
  // completion signal of an async reconcile instead of guessing with timer ticks
  const deferred = () => {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
  };

  describe('policyAllowsRun', () => {
    it('always restarts under the default policy regardless of exit code', () => {
      expect(appReconciler.policyAllowsRun('always', 0)).to.be.true;
      expect(appReconciler.policyAllowsRun('always', 1)).to.be.true;
    });
    it('on-failure restarts only on non-zero exit', () => {
      expect(appReconciler.policyAllowsRun('on-failure', 0)).to.be.false;
      expect(appReconciler.policyAllowsRun('on-failure', 1)).to.be.true;
      expect(appReconciler.policyAllowsRun('on-failure', null)).to.be.true; // never ran -> initial start
    });
    it('no only allows an initial start, never a restart after an exit', () => {
      expect(appReconciler.policyAllowsRun('no', null)).to.be.true;
      expect(appReconciler.policyAllowsRun('no', 0)).to.be.false;
      expect(appReconciler.policyAllowsRun('no', 5)).to.be.false;
    });
    it('defaults to always (the current resolver value)', () => {
      expect(appReconciler.getRestartPolicy({})).to.equal('always');
    });
  });

  describe('reconcile decisions', () => {
    it('does nothing when the app is not installed locally', async () => {
      localSpec = null;
      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
    });

    it('fails loud on invalid containerData (sync flag on a non-primary mount): no start/stop, no throw', async () => {
      // '/data|g:/...' puts the sync flag on a non-primary mount -> unparseable per the
      // mount model (real prod shape: roundcube). The reconciler must not attempt a start
      // (volume construction would throw) and must surface it, not silently loop "not ready".
      localSpec = { name: 'App', version: 4, compose: [{ name: 'www', containerData: '/data|g:/var/roundcube/db' }] };
      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
      const failedLoud = stubs.log.error.getCalls().some((c) => /invalid containerData/.test(c.args[0]));
      expect(failedLoud, 'should log the invalid-spec error (fail loud), not silently loop').to.equal(true);
    });

    it('defers (does not drop) the reconcile when the local spec read fails transiently', async () => {
      // a momentary DB read failure must not be mistaken for "not installed" - the
      // reconcile defers and retries rather than silently dropping the recovery
      stubs.dbHelper.findOneInDatabase.rejects(new Error('connection reset'));
      await appReconciler.reconcile('www_App'); // must not throw
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
      const deferred = stubs.log.warn.getCalls().some((c) => /spec read failed, deferring/.test(c.args[0]));
      expect(deferred, 'should log the transient defer, not silently no-op as not-installed').to.equal(true);
    });

    it('stops a running container the operator has stopped', async () => {
      stubs.appsRuntimeState.isOperatorStopped.resolves(true);
      stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: true, Status: 'running', ExitCode: 0 } });
      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerStop.calledOnceWith('www_App')).to.be.true;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('leaves an operator-stopped container alone if already stopped', async () => {
      stubs.appsRuntimeState.isOperatorStopped.resolves(true);
      await appReconciler.reconcile('www_App'); // inspect default: stopped
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('starts a stopped plain component that should run (default always policy)', async () => {
      await appReconciler.reconcile('www_App');
      expect(stubs.appsRuntimeState.recordRestart.calledOnceWith('www_App')).to.be.true;
      expect(stubs.dockerService.appDockerStart.calledOnceWith('www_App')).to.be.true;
      expect(stubs.appInspector.startAppMonitoring.calledOnce).to.be.true;
    });

    it('defers ALL actuation when the data volume cannot be mounted', async () => {
      // the app dir without its volume is an ordinary host dir: a start there
      // writes to the host filesystem instead of the volume - the reconciler
      // must keep the component inert and retry, never actuate
      stubs.volumeService.ensureAppVolumeMounted.resolves({ mounted: false, reason: 'mount_failed: bad superblock' });
      stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: true, Status: 'running', ExitCode: 0 } });
      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
      expect(stubs.dockerOperations.appDeleteDataInMountPoint.called).to.be.false;
      const deferredLoud = stubs.log.error.getCalls().some((c) => /data volume not mounted/.test(c.args[0]));
      expect(deferredLoud, 'should log the volume defer loudly').to.equal(true);
    });

    it('honors a pending stop even when the data volume cannot be mounted (mount-safety hold)', async () => {
      // a stop takes nothing from the app dir; deferring it left the incident's
      // container running over the gutted volume with the hold unenforceable
      stubs.volumeService.ensureAppVolumeMounted.resolves({ mounted: false, reason: 'volume_file_missing' });
      stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: true, Status: 'running', ExitCode: 0 } });
      try {
        appReconciler.setControllerDesired('www_App', 'stopped', 'mount safety block: unmounted_with_content');
        // setControllerDesired enqueues its own reconcile; wait for it to land
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(stubs.dockerService.appDockerStop.calledWith('www_App')).to.be.true;
        expect(stubs.dockerService.appDockerStart.called).to.be.false;
        expect(stubs.dockerOperations.appDeleteDataInMountPoint.called).to.be.false;
      } finally {
        appReconciler.clearControllerDesired('www_App');
      }
    });

    it('mounts an unmounted volume and proceeds with the start', async () => {
      stubs.volumeService.ensureAppVolumeMounted.resolves({ mounted: true, alreadyMounted: false });
      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerStart.calledOnceWith('www_App')).to.be.true;
      sinon.assert.callOrder(stubs.volumeService.ensureAppVolumeMounted, stubs.dockerService.appDockerStart);
    });

    it('records a tampering event once (not per retry) when the backing image is missing', async () => {
      stubs.volumeService.ensureAppVolumeMounted.resolves({ mounted: false, reason: 'volume_file_missing' });
      await appReconciler.reconcile('www_App');
      await appReconciler.reconcile('www_App');
      const volumeEvents = stubs.appTamperingDetectionService.recordEvent.getCalls()
        .filter((c) => c.args[1] === 'volume_missing');
      expect(volumeEvents).to.have.lengthOf(1);
      expect(volumeEvents[0].args[0]).to.equal('App');
    });

    it('ensures the volume is mounted before actuating a pending data wipe', async () => {
      appReconciler.requestStopAndClearData('www_App', 'test wipe');
      // requestStopAndClearData enqueues its own reconcile; wait for it to land
      await new Promise((resolve) => { setTimeout(resolve, 50); });
      expect(stubs.dockerOperations.appDeleteDataInMountPoint.calledOnce).to.be.true;
      sinon.assert.callOrder(stubs.volumeService.ensureAppVolumeMounted, stubs.dockerOperations.appDeleteDataInMountPoint);
    });

    it('ensures mount paths exist (recreating any syncthing-cleaned source) before starting', async () => {
      await appReconciler.reconcile('www_App');
      expect(stubs.volumeService.ensureMountPathsExist.calledOnce).to.be.true;
      // called with (componentSpec, mainAppName, isComponent, fullAppSpecs)
      const [comp, mainAppName, isComponent, fullAppSpecs] = stubs.volumeService.ensureMountPathsExist.firstCall.args;
      expect(comp).to.deep.equal({ name: 'www', containerData: '/data' });
      expect(mainAppName).to.equal('App');
      expect(isComponent).to.be.true;
      expect(fullAppSpecs).to.deep.equal(localSpec);
      // and the ensure must happen before the docker start, or the start could fail on a missing mount
      sinon.assert.callOrder(stubs.volumeService.ensureMountPathsExist, stubs.dockerService.appDockerStart);
    });

    it('does not start (or record a restart) when ensuring mount paths fails', async () => {
      stubs.volumeService.ensureMountPathsExist.rejects(new Error('mkdir failed'));
      let threw = false;
      try {
        await appReconciler.reconcile('www_App');
      } catch (err) {
        threw = true;
        expect(err.message).to.equal('mkdir failed');
      }
      expect(threw).to.be.true;
      expect(stubs.appsRuntimeState.recordRestart.called).to.be.false;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('does nothing when the container is already running', async () => {
      stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: true, Status: 'running', ExitCode: 0 } });
      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('recreates a missing container that should run (docker reachable)', async () => {
      // production shape of a genuinely-missing container: getDockerContainerOnly
      // returns undefined -> docker.getContainer(undefined.Id) throws a TypeError.
      stubs.dockerService.dockerContainerInspect.rejects(new TypeError("Cannot read properties of undefined (reading 'Id')"));
      stubs.dockerService.dockerListContainers.resolves([]); // probe: docker is up
      await appReconciler.reconcile('www_App');
      expect(stubs.appTamperingDetectionService.recordEvent.calledWithMatch('App', 'container_vanished')).to.be.true;
      expect(stubs.containerHealthMonitor.recreateMissingContainers.calledOnceWith('www_App')).to.be.true;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('removes the app locally when recreation fails (docker reachable)', async () => {
      stubs.dockerService.dockerContainerInspect.rejects(new TypeError("Cannot read properties of undefined (reading 'Id')"));
      stubs.dockerService.dockerListContainers.resolves([]); // probe: docker is up
      stubs.containerHealthMonitor.recreateMissingContainers.rejects(new Error('boom'));
      await appReconciler.reconcile('www_App');
      expect(stubs.appTamperingDetectionService.recordEvent.calledWithMatch('App', 'recreation_failed')).to.be.true;
      expect(stubs.appUninstaller.removeAppLocally.calledOnceWith('App', null, false, true, true)).to.be.true;
    });

    // "Vanished" requires docker to CONFIRM absence: the reachability probe
    // already fetched the full container list, and if the container appears in
    // it the inspect failure was transient (one-off timeout, dockerd finishing
    // a restart between the two calls). Acting on it would falsely write a
    // container_vanished tamper event and recreate->409->uninstall a healthy
    // app. Defer instead - the next inspect succeeds.
    it('defers when inspect fails but the container appears in the docker list (transient inspect failure)', async () => {
      stubs.dockerService.dockerContainerInspect.rejects(new TypeError("Cannot read properties of undefined (reading 'Id')"));
      stubs.dockerService.dockerListContainers.resolves([
        { Names: ['/fluxwww_App'], State: 'running' }, // the "missing" container, alive
        { Names: ['/fluxother_Other'], State: 'running' },
      ]);
      await appReconciler.reconcile('www_App');
      expect(stubs.containerHealthMonitor.recreateMissingContainers.called, 'must not recreate an existing container').to.be.false;
      expect(stubs.appTamperingDetectionService.recordEvent.called, 'must not write tamper events on a transient failure').to.be.false;
      expect(stubs.appUninstaller.removeAppLocally.called).to.be.false;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
      const deferred = stubs.log.warn.getCalls().some((c) => /deferring/.test(c.args[0]));
      expect(deferred, 'should defer loudly, not silently drop the reconcile').to.equal(true);
    });

    // Removal must be justified by the state of the world at REMOVAL time, not
    // at classification time: between them sits a whole recreate attempt (image
    // pull - seconds to minutes), during which a redeploy can legitimately
    // create the container (isManagedElsewhere is only sampled at entry), or
    // our own recreate can fail AFTER creating it (start/network step failed).
    it('does not remove the app when the container exists by the time recreation fails', async () => {
      stubs.dockerService.dockerContainerInspect.rejects(new TypeError("Cannot read properties of undefined (reading 'Id')"));
      stubs.dockerService.dockerListContainers.resolves([]); // genuinely missing at classification
      stubs.containerHealthMonitor.recreateMissingContainers.rejects(new Error('409 Conflict: name already in use'));
      stubs.dockerService.getDockerContainerOnly.resolves({ Id: 'abc123' }); // exists at re-check
      await appReconciler.reconcile('www_App');
      expect(stubs.appUninstaller.removeAppLocally.called, 'must not remove - the container exists').to.be.false;
      const recordedFailure = stubs.appTamperingDetectionService.recordEvent.getCalls()
        .some((c) => c.args[1] === 'recreation_failed');
      expect(recordedFailure, 'a moot recreate failure must not pollute the tamper ledger').to.be.false;
    });

    it('defers (never recreates/uninstalls) when docker is unreachable', async () => {
      // dockerd is down (e.g. restarting): inspect throws AND the reachability
      // probe throws too -> must defer, not mistake it for a vanished container.
      const connErr = new Error('connect ENOENT /var/run/docker.sock');
      connErr.code = 'ENOENT';
      stubs.dockerService.dockerContainerInspect.rejects(connErr);
      stubs.dockerService.dockerListContainers.rejects(connErr); // probe: docker is down
      await appReconciler.reconcile('www_App');
      expect(stubs.containerHealthMonitor.recreateMissingContainers.called).to.be.false;
      expect(stubs.appUninstaller.removeAppLocally.called).to.be.false;
      expect(stubs.appTamperingDetectionService.recordEvent.called).to.be.false;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('does NOT start a g: component until a controller elects it', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      await appReconciler.reconcile('db_App'); // controllerDesired unset
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('starts a g: component once a controller sets it running', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      // set desired without triggering the workqueue (boot gate closed -> enqueue held)
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.setControllerDesired('db_App', 'running', 'test');
      stubs.globalState.bootContainerStateSettled = true;
      await appReconciler.reconcile('db_App');
      expect(stubs.dockerService.appDockerStart.calledOnceWith('db_App')).to.be.true;
    });

    // The controller verdict is sampled at reconcile entry, but the syncthing
    // decider's stop wrapper runs OUTSIDE the reconciler's single-flight: it can
    // flip the verdict and begin a data wipe while this reconcile is awaiting
    // (mount-path recreation, DB reads). The verdict must therefore be re-read at
    // actuation time - starting onto a folder mid-wipe corrupts the fresh sync.
    it('aborts the start when the controller verdict flips to stopped mid-reconcile', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.setControllerDesired('db_App', 'running', 'test');
      stubs.globalState.bootContainerStateSettled = true;
      // decider stop+wipe lands during the mount-path await
      stubs.volumeService.ensureMountPathsExist.callsFake(async () => {
        appReconciler.setControllerDesired('db_App', 'stopped', 'decider stop+wipe');
      });
      await appReconciler.reconcile('db_App');
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('aborts the start when the controller verdict is cleared mid-reconcile (uninstall seam)', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.setControllerDesired('db_App', 'running', 'test');
      stubs.globalState.bootContainerStateSettled = true;
      stubs.volumeService.ensureMountPathsExist.callsFake(async () => {
        appReconciler.clearControllerDesired('db_App');
      });
      await appReconciler.reconcile('db_App');
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('does NOT act on a cleared controller verdict (removal seam wipes it)', async () => {
      // uninstall fires appUninstaller's component-removed seam -> serviceManager
      // wires it to clearControllerDesired: a reinstalled g: component must await a
      // fresh election rather than inherit the pre-uninstall verdict
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.setControllerDesired('db_App', 'running', 'test');
      stubs.globalState.bootContainerStateSettled = true;
      appReconciler.clearControllerDesired('db_App');
      await appReconciler.reconcile('db_App');
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
    });

    // the actuation half of the masterSlave standby path: the decider sets a running
    // g: component desired-stopped, the reconciler is what actually stops Docker.
    it('stops a running g: component a controller has set stopped (masterSlave standby)', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: true, Status: 'running', ExitCode: 0 } });
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.setControllerDesired('db_App', 'stopped', 'masterSlave standby');
      stubs.globalState.bootContainerStateSettled = true;
      await appReconciler.reconcile('db_App');
      expect(stubs.dockerService.appDockerStop.calledOnceWith('db_App')).to.be.true;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    // controllerDesired is in-memory, so a FluxOS restart wipes it while the
    // container keeps running (Docker is independent of the FluxOS process). With
    // no controller opinion yet the reconciler must leave a running g:/r: container
    // alone - stopping it here would bounce every running syncthing app on every
    // FluxOS restart. The decider re-derives intent within its next cycle.
    it('leaves a running g: component alone when no controller has spoken yet', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: true, Status: 'running', ExitCode: 0 } });
      await appReconciler.reconcile('db_App'); // controllerDesired unset
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('leaves a running r: component alone when no controller has spoken yet (FluxOS-restart case)', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'web', containerData: 'r:/data' }] };
      stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: true, Status: 'running', ExitCode: 0 } });
      await appReconciler.reconcile('web_App'); // controllerDesired unset
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    // the syncthing decider wires its callbacks to the flux-prefixed docker name,
    // while masterSlave/die-events use the bare identifier. The reconciler must
    // canonicalise at its boundary so both forms key the same component: a desired
    // state written under the prefixed id is honoured by a reconcile of the bare id.
    it('canonicalises a flux-prefixed controller id to the bare component', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.setControllerDesired('fluxdb_App', 'running', 'syncthing synced');
      stubs.globalState.bootContainerStateSettled = true;
      await appReconciler.reconcile('db_App');
      expect(stubs.dockerService.appDockerStart.calledOnceWith('db_App')).to.be.true;
    });

    it('defers while another operation owns the container', async () => {
      stubs.globalState.isOperationInProgress = () => true;
      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
    });

    // The backup/restore lease: while an app appears in backupInProgress /
    // restoreInProgress (bare MAIN APP name, exactly as appendBackupTask /
    // appendRestoreTask write it), the operation owns the whole app's runtime.
    // A reconcile of ANY component of that app must not actuate - not start,
    // not stop, not recreate - while the lease is held; the next reconcile
    // after release enforces desired state again.
    describe('backup/restore lease', () => {
      it('does not start a stopped component while its app is being backed up', async () => {
        stubs.globalState.backupInProgress.push('App'); // bare main-app name (production format)
        await appReconciler.reconcile('www_App');
        expect(stubs.dockerService.appDockerStart.called).to.be.false;
        expect(stubs.appsRuntimeState.recordRestart.called).to.be.false;
      });

      it('does not stop a running operator-stopped component while its app is being restored', async () => {
        stubs.globalState.restoreInProgress.push('App');
        stubs.appsRuntimeState.isOperatorStopped.resolves(true);
        stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: true, Status: 'running', ExitCode: 0 } });
        await appReconciler.reconcile('www_App');
        expect(stubs.dockerService.appDockerStop.called).to.be.false;
      });

      it('does not recreate or remove a missing container while its app is being restored', async () => {
        stubs.globalState.restoreInProgress.push('App');
        stubs.dockerService.dockerContainerInspect.rejects(new TypeError("Cannot read properties of undefined (reading 'Id')"));
        stubs.dockerService.dockerListContainers.resolves([]); // probe: docker is up
        await appReconciler.reconcile('www_App');
        expect(stubs.containerHealthMonitor.recreateMissingContainers.called).to.be.false;
        expect(stubs.appUninstaller.removeAppLocally.called).to.be.false;
        expect(stubs.appTamperingDetectionService.recordEvent.called).to.be.false;
      });

      it('enforces desired state again once the lease is released', async () => {
        stubs.globalState.backupInProgress.push('App');
        await appReconciler.reconcile('www_App');
        expect(stubs.dockerService.appDockerStart.called).to.be.false; // held

        stubs.globalState.backupInProgress.length = 0; // lease released
        await appReconciler.reconcile('www_App');
        expect(stubs.dockerService.appDockerStart.calledOnceWith('www_App')).to.be.true;
      });
    });

    it('defers while the container is in stoppingContainers (transient stop)', async () => {
      stubs.globalState.stoppingContainers.add('fluxwww_App');
      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('backs off instead of restarting when a wait is pending', async () => {
      stubs.appsRuntimeState.restartWaitMs.resolves(30 * 1000);
      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
      expect(stubs.appsRuntimeState.recordRestart.called).to.be.false;
    });

    // No die event fires for a FAILED start (the container never ran), so a start
    // throw that is merely logged leaves the component down until the hourly
    // sweep. The failure must schedule its own retry; pacing is free because the
    // attempt was recorded before the start - the retry walks the ladder.
    it('schedules its own retry when the start fails (not the hourly sweep)', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
      stubs.dockerService.appDockerStart.rejects(new Error('failed to attach network'));

      await appReconciler.reconcile('www_App'); // must not throw

      expect(stubs.dockerService.appDockerStart.callCount).to.equal(1);
      clock.tick(6000); // past the near-term retry
      await new Promise((resolve) => { setImmediate(() => { setImmediate(resolve); }); });
      expect(stubs.dockerService.appDockerStart.callCount).to.equal(2);
      // each attempt was recorded, so the follow-ups pace via the backoff ladder
      expect(stubs.appsRuntimeState.recordRestart.callCount).to.equal(2);
      clock.restore();
    });

    it('converges after a successful start: the verification pass re-checks but does not act again', async () => {
      // a successful start schedules ONE verification pass (a container can come up
      // detached from its network). That pass must find the container running and
      // stop there - not start it again, and not keep re-arming itself.
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
      stubs.dockerService.appDockerStart.callsFake(async () => {
        stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: true, Status: 'running', ExitCode: 0 } });
      });

      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerStart.callCount).to.equal(1);

      clock.tick(60 * 1000);
      await new Promise((resolve) => { setImmediate(() => { setImmediate(resolve); }); });
      expect(stubs.dockerService.dockerContainerInspect.callCount, 'the verification pass ran').to.be.above(1);
      expect(stubs.dockerService.appDockerStart.callCount, 'a running container is left alone').to.equal(1);

      clock.tick(10 * 60 * 1000); // no further passes are armed once it is healthy
      await new Promise((resolve) => { setImmediate(() => { setImmediate(resolve); }); });
      expect(stubs.dockerService.appDockerStart.callCount).to.equal(1);
      clock.restore();
    });

    it('hands docker FinishedAt to the backoff decision (true death time even when the die event was missed)', async () => {
      const finishedAt = '2026-06-12T08:00:00.000Z';
      stubs.dockerService.dockerContainerInspect.resolves({
        State: {
          Running: false, Status: 'exited', ExitCode: 1, FinishedAt: finishedAt,
        },
      });
      await appReconciler.reconcile('www_App');
      sinon.assert.calledWithExactly(stubs.appsRuntimeState.restartWaitMs, 'www_App', Date.parse(finishedAt));
    });

    it('passes no death evidence for a container that never ran (docker zero FinishedAt)', async () => {
      stubs.dockerService.dockerContainerInspect.resolves({
        State: {
          Running: false, Status: 'created', ExitCode: 0, FinishedAt: '0001-01-01T00:00:00Z',
        },
      });
      await appReconciler.reconcile('www_App');
      sinon.assert.calledWithExactly(stubs.appsRuntimeState.restartWaitMs, 'www_App', null);
    });
  });

  // The sync layer's first-run / new-app reset was previously an imperative
  // stop+rm-rf done OUTSIDE the reconciler's single-flight, so a backoff-elapsed
  // start could land in the wipe window and corrupt fresh data (the S1 data-loss
  // race). The wipe is now declared as desired data-state and actuated by the
  // reconciler - the sole container/data actuator - inside the per-key single-
  // flight, which makes start-into-wipe structurally impossible.
  describe('data-clear (sync-layer wipe via the reconciler)', () => {
    // requestStopAndClearData is wired with the flux-prefixed docker name (the form
    // the syncthing flow uses); the reconciler keys state by the bare component id
    // and re-prefixes for the on-disk wipe path.
    it('wipes local appdata (prefixed path) and does not start, on a clear request', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.requestStopAndClearData('fluxdb_App', 'syncthing first-run');
      stubs.globalState.bootContainerStateSettled = true;
      await appReconciler.reconcile('db_App');
      expect(stubs.dockerOperations.appDeleteDataInMountPoint.calledOnceWith('fluxdb_App')).to.be.true;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    // The structural guarantee: even with a contradictory running verdict, the
    // pending clear is resolved before the run decision in the SAME single-flight,
    // so a start can never race the wipe.
    it('never starts while a clear is pending, even if the controller says running', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.requestStopAndClearData('fluxdb_App', 'syncthing first-run');
      appReconciler.setControllerDesired('fluxdb_App', 'running', 'contrived contradiction');
      stubs.globalState.bootContainerStateSettled = true;
      await appReconciler.reconcile('db_App');
      expect(stubs.dockerOperations.appDeleteDataInMountPoint.called).to.be.true;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('stops a running container before wiping (no rm -rf under a live container)', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: true, Status: 'running', ExitCode: 0 } });
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.requestStopAndClearData('fluxdb_App', 'syncthing reset');
      stubs.globalState.bootContainerStateSettled = true;
      await appReconciler.reconcile('db_App');
      expect(stubs.dockerService.appDockerStop.calledWith('db_App')).to.be.true;
      sinon.assert.callOrder(stubs.dockerService.appDockerStop, stubs.dockerOperations.appDeleteDataInMountPoint);
    });

    it('is one-shot: wipes first, then the next reconcile starts once the verdict is running', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.requestStopAndClearData('fluxdb_App', 'syncthing first-run');
      // sync layer has already confirmed a source and elected running; the pending
      // clear must still win the first pass
      appReconciler.setControllerDesired('fluxdb_App', 'running', 'syncthing synced');
      stubs.globalState.bootContainerStateSettled = true;

      await appReconciler.reconcile('db_App'); // clear wins -> wipes, no start
      expect(stubs.dockerOperations.appDeleteDataInMountPoint.calledOnce).to.be.true;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;

      await appReconciler.reconcile('db_App'); // flag cleared -> now starts
      expect(stubs.dockerService.appDockerStart.calledOnceWith('db_App')).to.be.true;
      expect(stubs.dockerOperations.appDeleteDataInMountPoint.calledOnce).to.be.true; // no second wipe
    });

    it('keys the clear per-component (clearing one app does not wipe another)', async () => {
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.requestStopAndClearData('fluxdb_App', 'reset db');
      appReconciler.setControllerDesired('fluxweb_Other', 'running', 'synced');
      stubs.globalState.bootContainerStateSettled = true;
      localSpec = { name: 'Other', version: 4, compose: [{ name: 'web', containerData: 'r:/data' }] };
      await appReconciler.reconcile('web_Other');
      expect(stubs.dockerOperations.appDeleteDataInMountPoint.called).to.be.false;
      expect(stubs.dockerService.appDockerStart.calledOnceWith('web_Other')).to.be.true;
    });

    // A failed stop/wipe (busy mount, fs error, docker blip) is the one actuation
    // path that otherwise just drops to the hourly sweep (~1h down). It must arm its
    // own quick retry like the start path does.
    it('schedules its own retry when the wipe fails (not the hourly sweep)', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      stubs.dockerOperations.appDeleteDataInMountPoint.rejects(new Error('mount busy'));
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.requestStopAndClearData('fluxdb_App', 'syncthing first-run');
      stubs.globalState.bootContainerStateSettled = true;

      await appReconciler.reconcile('db_App'); // must not throw

      expect(stubs.dockerOperations.appDeleteDataInMountPoint.callCount).to.equal(1);
      clock.tick(6000); // past the near-term retry (MANAGED_RETRY_MS)
      await new Promise((resolve) => { setImmediate(() => { setImmediate(resolve); }); });
      expect(stubs.dockerOperations.appDeleteDataInMountPoint.callCount).to.equal(2);
      clock.restore();
    });

    // The data-safety invariant must survive a failed wipe: the clear stays pending so
    // a later reconcile re-runs the (idempotent) wipe and can NEVER start the container
    // on un-wiped data, even when the controller already says running.
    it('keeps the clear pending on a failed wipe — never starts on un-wiped data', async () => {
      localSpec = { name: 'App', version: 4, compose: [{ name: 'db', containerData: 'g:/data' }] };
      stubs.dockerOperations.appDeleteDataInMountPoint.rejects(new Error('mount busy'));
      stubs.globalState.bootContainerStateSettled = false;
      appReconciler.requestStopAndClearData('fluxdb_App', 'syncthing first-run');
      appReconciler.setControllerDesired('fluxdb_App', 'running', 'contrived contradiction');
      stubs.globalState.bootContainerStateSettled = true;

      await appReconciler.reconcile('db_App'); // first attempt: wipe throws, caught

      stubs.dockerOperations.appDeleteDataInMountPoint.resetHistory();
      await appReconciler.reconcile('db_App'); // flag still 'clear' -> re-wipes, no start
      expect(stubs.dockerOperations.appDeleteDataInMountPoint.called).to.be.true;
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });
  });

  describe('component selection and enterprise decryption', () => {
    // The reconciler is per-component: reconcile(<comp>_<app>) must resolve exactly the
    // matching compose entry out of a multi-entry app, so a partial state (one component
    // crashed while siblings run) is enforced on the right component with the right type.
    it('selects the matching entry from a multi-component compose (partial state)', async () => {
      localSpec = {
        name: 'App',
        version: 4,
        compose: [
          { name: 'www', containerData: '/data' },
          { name: 'db', containerData: 'g:/data' }, // master/slave - needs a controller
          { name: 'cache', containerData: '/cache' }, // plain - always policy
        ],
      };
      // 'cache' is plain -> a stopped one is started (picked 'cache', not 'www' or g: 'db')
      await appReconciler.reconcile('cache_App');
      expect(stubs.dockerService.appDockerStart.calledOnceWith('cache_App')).to.be.true;

      // 'db' is g: -> NOT started without a controller (picked 'db', not plain 'cache'/'www')
      stubs.dockerService.appDockerStart.resetHistory();
      await appReconciler.reconcile('db_App');
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
    });

    it('acts on the decrypted spec, not the encrypted one, for an enterprise app', async () => {
      // stored (encrypted) spec has no usable containerData; decryption reveals it is g:
      localSpec = {
        name: 'App', version: 8, enterprise: 'CIPHERTEXT', compose: [{ name: 'db', containerData: '' }],
      };
      stubs.appQueryService.decryptEnterpriseApps.callsFake(async () => [
        { name: 'App', version: 8, compose: [{ name: 'db', containerData: 'g:/data' }] },
      ]);
      await appReconciler.reconcile('db_App');
      // treated as g: from the DECRYPTED containerData -> not started without a controller.
      // If it had acted on the encrypted spec (containerData '') it would be a plain start.
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
    });

    it('defers (does not act on encrypted data) when enterprise decryption fails', async () => {
      localSpec = {
        name: 'App', version: 8, enterprise: 'CIPHERTEXT', compose: [{ name: 'db', containerData: '' }],
      };
      // throwOnError path: decryption failing (e.g. key not loaded at boot) must propagate
      stubs.appQueryService.decryptEnterpriseApps.rejects(new Error('enterpriseKey is mandatory'));
      await appReconciler.reconcile('db_App'); // must not throw
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
      const deferred = stubs.log.warn.getCalls().some((c) => /spec read failed, deferring/.test(c.args[0]));
      expect(deferred, 'should defer on decrypt failure, never act on still-encrypted data').to.equal(true);
    });
  });

  // The sweep contract: enqueueAll must cover EVERY installed component -
  // enterprise apps included. Enterprise specs are stored encrypted
  // (compose: []), so the sweep decrypts (leniently - one failing app must not
  // abort the sweep) to enumerate components; for an app whose decryption
  // fails it falls back to the app's existing docker containers, so reconciles
  // get queued and converge the moment decryption recovers (reconcile itself
  // never acts on encrypted data - it defers). Assertions target the coverage
  // contract (what got swept), not the mechanism.
  describe('enqueueAll sweep coverage', () => {
    // every reconcile chain here is built from immediately-resolving stubs
    // (pure microtasks), so two macrotask turns deterministically drain all
    // reconciles the sweep enqueued (the second covers the workqueue's one
    // setImmediate hop for a coalesced re-run)
    const flush = async () => {
      await new Promise((resolve) => { setImmediate(resolve); });
      await new Promise((resolve) => { setImmediate(resolve); });
    };

    it('sweeps every component of an enterprise app when decryption succeeds', async () => {
      const stored = {
        name: 'EntApp', version: 8, enterprise: 'CIPHERTEXT', hash: 'h1', compose: [],
      };
      const decrypted = { ...stored, compose: [{ name: 'c1', containerData: '/data' }, { name: 'c2', containerData: '/data' }] };
      stubs.appQueryService.installedApps.resolves({ status: 'success', data: [stored] });
      stubs.dbHelper.findOneInDatabase.callsFake(async (db, coll, query) => (query.name === 'EntApp' ? stored : null));
      stubs.appQueryService.decryptEnterpriseApps.callsFake(async (arr) => arr.map((a) => (a.enterprise ? decrypted : a)));

      const started = [];
      stubs.dockerService.appDockerStart.callsFake(async (id) => { started.push(id); });

      await appReconciler.enqueueAll('test');
      await flush();
      expect(started, 'both enterprise components must be swept and reconciled to a start').to.have.members(['c1_EntApp', 'c2_EntApp']);
    });

    it('falls back to the app\'s docker containers when decryption fails - reconciles queue and defer', async () => {
      const stored = {
        name: 'EntApp', version: 8, enterprise: 'CIPHERTEXT', hash: 'h1', compose: [],
      };
      stubs.appQueryService.installedApps.resolves({ status: 'success', data: [stored] });
      stubs.dbHelper.findOneInDatabase.callsFake(async (db, coll, query) => (query.name === 'EntApp' ? stored : null));
      // benchd unavailable: lenient calls return the spec still encrypted, strict callers get the throw
      stubs.appQueryService.decryptEnterpriseApps.callsFake(async (arr, opts) => {
        if (opts && opts.throwOnError) throw new Error('benchd unavailable');
        return arr;
      });
      // the app's existing containers, plus an unrelated app's container that
      // this fallback must NOT sweep in (it is not part of the failed app)
      stubs.dockerService.dockerListContainers.resolves([
        { Names: ['/fluxc1_EntApp'] },
        { Names: ['/fluxc2_EntApp'] },
        { Names: ['/fluxweb_Other'] },
      ]);

      const defers = [];
      stubs.log.warn.callsFake((msg) => {
        if (/spec read failed, deferring/.test(msg)) defers.push(msg);
      });

      await appReconciler.enqueueAll('test');
      await flush();
      // both components reached reconcile and deferred on the failed decrypt
      expect(defers.some((m) => m.includes('c1_EntApp')), 'c1_EntApp must be swept (docker-derived) and defer').to.be.true;
      expect(defers.some((m) => m.includes('c2_EntApp')), 'c2_EntApp must be swept (docker-derived) and defer').to.be.true;
      expect(defers.some((m) => m.includes('web_Other')), 'unrelated app must not be swept by the fallback').to.be.false;
      // never actuate on encrypted data
      expect(stubs.dockerService.appDockerStart.called).to.be.false;
      expect(stubs.dockerService.appDockerStop.called).to.be.false;
    });

    it('an undecryptable app does not abort the sweep for other apps', async () => {
      const ent = {
        name: 'EntApp', version: 8, enterprise: 'CIPHERTEXT', hash: 'h1', compose: [],
      };
      const plain = { name: 'Plain', version: 4, compose: [{ name: 'www', containerData: '/data' }] };
      const byName = { EntApp: ent, Plain: plain };
      // the failing app FIRST: a sweep that dies on it would never reach Plain
      stubs.appQueryService.installedApps.resolves({ status: 'success', data: [ent, plain] });
      stubs.dbHelper.findOneInDatabase.callsFake(async (db, coll, query) => byName[query.name] ?? null);
      stubs.appQueryService.decryptEnterpriseApps.callsFake(async (arr, opts) => {
        if (opts && opts.throwOnError && arr.some((a) => a.enterprise)) throw new Error('benchd unavailable');
        return arr;
      });
      stubs.dockerService.dockerListContainers.resolves([{ Names: ['/fluxc1_EntApp'] }]);

      const started = [];
      stubs.dockerService.appDockerStart.callsFake(async (id) => { started.push(id); });
      const defers = [];
      stubs.log.warn.callsFake((msg) => {
        if (/spec read failed, deferring/.test(msg)) defers.push(msg);
      });

      await appReconciler.enqueueAll('test');
      await flush();
      expect(started, 'the plain app must still reconcile and start').to.include('www_Plain');
      expect(defers.some((m) => m.includes('c1_EntApp')), 'the failed app is still covered via its docker container').to.be.true;
    });

    // coverage guard (passes today): the legacy single-spec path must survive the fix
    it('sweeps a legacy (v1-3) app under its app name', async () => {
      const legacy = { name: 'Legacy', version: 3, containerData: '/data' };
      stubs.appQueryService.installedApps.resolves({ status: 'success', data: [legacy] });
      stubs.dbHelper.findOneInDatabase.callsFake(async (db, coll, query) => (query.name === 'Legacy' ? legacy : null));

      const started = [];
      stubs.dockerService.appDockerStart.callsFake(async (id) => { started.push(id); });

      await appReconciler.enqueueAll('test');
      await flush();
      expect(started).to.deep.equal(['Legacy']);
    });
  });

  // The boot-drain gate: the first apprunning broadcast must not race the boot
  // reconciles (a too-early snapshot misses apps whose rows then expire on the
  // sigterm TTL). waitForBootDrainSettled() resolves once every boot-held
  // component has completed ONE reconcile pass (started, backoff-deferred,
  // awaiting-controller, or failed loudly) - NOT "all containers running" - and
  // is capped so a wedged reconcile cannot suppress network presence forever.
  describe('boot drain gate', () => {
    const flush = async () => {
      await new Promise((resolve) => { setImmediate(resolve); });
      await new Promise((resolve) => { setImmediate(resolve); });
    };

    it('opens only after every boot-held reconcile completes one pass', async () => {
      stubs.globalState.bootContainerStateSettled = false;
      let openBootGate;
      stubs.globalState.waitForBootContainerStateSettled = () => new Promise((resolve) => { openBootGate = resolve; });
      let finishInspect;
      stubs.dockerService.dockerContainerInspect = sinon.stub().callsFake(() => new Promise((resolve) => {
        finishInspect = () => resolve({ State: { Running: false, Status: 'exited', ExitCode: 1 } });
      }));

      appReconciler.enqueue('www_App'); // held in bootPending
      const startPromise = appReconciler.start();
      let drainSettled = false;
      appReconciler.waitForBootDrainSettled().then(() => { drainSettled = true; });

      stubs.globalState.bootContainerStateSettled = true;
      openBootGate();
      await startPromise;
      await flush();
      expect(drainSettled, 'gate must hold while a boot reconcile is still in flight').to.be.false;

      finishInspect(); // the held reconcile completes its pass (start path runs on stubs)
      await flush();
      expect(drainSettled, 'gate opens once the drained reconciles complete one pass').to.be.true;
    });

    it('opens after the cap even if a boot reconcile wedges', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        stubs.globalState.bootContainerStateSettled = false;
        let openBootGate;
        stubs.globalState.waitForBootContainerStateSettled = () => new Promise((resolve) => { openBootGate = resolve; });
        stubs.dockerService.dockerContainerInspect = sinon.stub().callsFake(() => new Promise(() => {})); // wedged forever

        appReconciler.enqueue('www_App');
        const startPromise = appReconciler.start();
        let drainSettled = false;
        appReconciler.waitForBootDrainSettled().then(() => { drainSettled = true; });

        stubs.globalState.bootContainerStateSettled = true;
        openBootGate();
        await startPromise;
        await flush();
        expect(drainSettled).to.be.false;

        clock.tick(2 * 60 * 1000 + 1); // the cap (~2min) fires
        await flush();
        expect(drainSettled, 'the cap must open the gate despite a wedged reconcile').to.be.true;
      } finally {
        clock.restore();
      }
    });
  });

  // The started-nudge: a container start is information the network wants NOW
  // (a backoff straggler that starts minutes after boot must refresh its
  // appsLocations row inside the ~7min sigterm TTL window, not at the hourly
  // tick). serviceManager wires this callback to the peer broadcast, mirroring
  // appInstaller.setOnInstallComplete; the broadcast layer coalesces bursts.
  describe('container-started notification', () => {
    it('notifies the registered callback after a successful start', async () => {
      const onStarted = sinon.stub();
      appReconciler.setOnContainerStarted(onStarted);
      await appReconciler.reconcile('www_App'); // stopped + always policy -> starts
      expect(stubs.dockerService.appDockerStart.calledOnce).to.be.true;
      expect(onStarted.calledOnceWith('www_App')).to.be.true;
    });

    it('does not notify on a stop or a failed start', async () => {
      const onStarted = sinon.stub();
      appReconciler.setOnContainerStarted(onStarted);

      // reconcile that stops an operator-stopped running container
      stubs.appsRuntimeState.isOperatorStopped.resolves(true);
      stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: true, Status: 'running', ExitCode: 0 } });
      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerStop.calledOnce).to.be.true;
      expect(onStarted.called).to.be.false;

      // reconcile whose docker start throws
      stubs.appsRuntimeState.isOperatorStopped.resolves(false);
      stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: false, Status: 'exited', ExitCode: 1 } });
      stubs.dockerService.appDockerStart.rejects(new Error('boom'));
      await appReconciler.reconcile('www_App').catch(() => {});
      expect(onStarted.called).to.be.false;
    });
  });

  describe('workqueue', () => {
    it('enqueue runs a reconcile once the boot gate is open', async () => {
      // startAppMonitoring is the last step of a start-path reconcile
      const done = deferred();
      stubs.appInspector.startAppMonitoring = sinon.stub().callsFake(() => done.resolve());
      appReconciler.enqueue('www_App');
      await done.promise;
      expect(stubs.dockerService.appDockerStart.calledOnceWith('www_App')).to.be.true;
    });

    it('holds enqueues until boot settles, then drains them on start()', async () => {
      let openGate;
      stubs.globalState.bootContainerStateSettled = false;
      stubs.globalState.waitForBootContainerStateSettled = () => new Promise((res) => { openGate = res; });

      appReconciler.enqueue('www_App');
      // enqueue is synchronous while the gate is closed, so this is a real assertion
      expect(stubs.dockerService.dockerContainerInspect.called).to.be.false; // held

      const done = deferred();
      stubs.appInspector.startAppMonitoring = sinon.stub().callsFake(() => done.resolve());
      const startPromise = appReconciler.start();
      stubs.globalState.bootContainerStateSettled = true;
      openGate();
      await startPromise;
      await done.promise; // the drained reconcile actually completed
      expect(stubs.dockerService.dockerContainerInspect.called).to.be.true;
    });

    it('coalesces concurrent enqueues for the same id into a single re-run', async () => {
      const resolvers = [];
      const reachedInspect = [deferred(), deferred()];
      stubs.dockerService.dockerContainerInspect = sinon.stub().callsFake(() => new Promise((res) => {
        resolvers.push(() => res({ State: { Running: true, Status: 'running', ExitCode: 0 } }));
        const d = reachedInspect[resolvers.length - 1];
        if (d) d.resolve();
      }));

      appReconciler.enqueue('www_App'); // reconcile #1 -> blocks at inspect
      await reachedInspect[0].promise;
      expect(resolvers).to.have.lengthOf(1);

      appReconciler.enqueue('www_App'); // in-flight -> mark dirty
      appReconciler.enqueue('www_App'); // still dirty (coalesced, not a separate run)
      resolvers[0](); // finish #1 -> exactly one coalesced re-run
      await reachedInspect[1].promise;
      expect(resolvers).to.have.lengthOf(2); // one re-run, not two
      resolvers[1]();
    });
  });

  describe('network-detach heal', () => {
    // A running container reported as detached from its own docker network (stale
    // libnetwork endpoint). isContainerDetachedFromNetwork is stubbed directly so
    // these tests drive the reconciler's control flow, not the classifier (covered
    // by dockerService tests).
    //
    // A heal needs the detach to (a) survive an in-pass re-inspect and (b) persist
    // for DETACHED_PERSIST_MS of wall-clock. Date is faked so tests can cross that
    // window without waiting; setTimeout is NOT faked, so the reconciler's own
    // scheduleRetry timers never fire and each pass is driven explicitly.
    let clock;

    beforeEach(() => {
      clock = sinon.useFakeTimers({ toFake: ['Date'] });
      stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: true, Status: 'running', ExitCode: 0 } });
      stubs.dockerService.classifyContainerNetworkAttachment.returns({
        managed: true, running: true, networkMode: 'fluxDockerNetwork_App', attached: false,
      });
      stubs.dockerService.isContainerDetachedFromNetwork.returns(true);
    });

    // first pass opens the persistence window; the second, past it, may act
    const healPasses = async (id = 'www_App') => {
      await appReconciler.reconcile(id);
      clock.tick(61 * 1000);
      await appReconciler.reconcile(id);
    };

    it('leaves a running, properly-attached container alone and clears any heal state', async () => {
      stubs.dockerService.isContainerDetachedFromNetwork.returns(false);
      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerForceRemove.called).to.be.false;
      expect(stubs.containerHealthMonitor.recreateMissingContainers.called).to.be.false;
      expect(stubs.appsRuntimeState.clearNetworkHeal.calledWith('www_App'), 'a healthy container clears the durable heal state').to.be.true;
    });

    it('clears the durable heal state for a container that merely EXISTS, even stopped', async () => {
      // the flag means "absent because I removed it" - once the container is back it
      // is stale, whatever its run state. Leaking it would divert a later, genuine
      // disappearance away from the vanished path forever.
      stubs.dockerService.dockerContainerInspect.resolves({ State: { Running: false, Status: 'exited', ExitCode: 0 } });
      stubs.dockerService.isContainerDetachedFromNetwork.returns(false);
      stubs.appsRuntimeState.restartWaitMs.resolves(60 * 1000); // stay in backoff, never start

      await appReconciler.reconcile('www_App');

      expect(stubs.appsRuntimeState.clearNetworkHeal.calledWith('www_App')).to.be.true;
    });

    it('confirms in-pass before acting: a detached read that clears on re-inspect destroys nothing', async () => {
      // a pass reads the attachment three times: the stale-state clear, the running
      // branch, then the heal's confirming re-inspect. Detached for the first two,
      // attached on the re-inspect - i.e. the first read was transient.
      stubs.dockerService.isContainerDetachedFromNetwork.onCall(2).returns(false);
      await appReconciler.reconcile('www_App');
      expect(stubs.serviceHelper.delay.called, 'settles before re-reading').to.be.true;
      expect(stubs.dockerService.dockerContainerInspect.callCount, 're-inspects to confirm').to.be.at.least(2);
      expect(stubs.dockerService.appDockerForceRemove.called, 'a transient detached read must never destroy a healthy container').to.be.false;
    });

    it('waits for the detach to persist before destroying anything', async () => {
      await appReconciler.reconcile('www_App'); // confirmed detached, but only just now
      expect(stubs.dockerService.appDockerForceRemove.called, 'a detach seen for the first time is not yet actionable').to.be.false;

      clock.tick(61 * 1000);
      await appReconciler.reconcile('www_App');
      expect(stubs.dockerService.appDockerForceRemove.called, 'a detach that persisted is healed').to.be.true;
    });

    it('heals a persisted detach: durable flag before the remove, monitoring stopped, soft-only recreate, never uninstall', async () => {
      await healPasses();
      expect(
        stubs.appsRuntimeState.setNetworkHealRemoval.calledWith('www_App', true),
        'records the deliberate removal durably',
      ).to.be.true;
      expect(
        stubs.appsRuntimeState.setNetworkHealRemoval.calledBefore(stubs.dockerService.appDockerForceRemove),
        'the flag must be durable BEFORE the container is removed, or a restart in the window reads the absence as tampering',
      ).to.be.true;
      expect(stubs.appInspector.stopAppMonitoring.calledWith('www_App', true), 'stops the stats monitor before removing').to.be.true;
      expect(stubs.dockerService.appDockerForceRemove.calledWith('www_App', false), 'force-removes keeping bind-mounted data').to.be.true;
      expect(
        stubs.containerHealthMonitor.recreateMissingContainers.calledOnceWith('www_App', { softOnly: true }),
        'the recreate must never be allowed to fall back to a hard install: that reformats the data volume',
      ).to.be.true;
      expect(stubs.appUninstaller.removeAppLocally.called, 'the heal must NEVER uninstall the app').to.be.false;
    });

    it('refuses to destroy a container it could never recreate (v1-3 app with no compose spec)', async () => {
      // recreateMissingContainers throws unconditionally on a spec with no compose
      // array, and the heal never escalates - so removing such a container would
      // destroy it permanently.
      localSpec = { name: 'App', version: 3, containerData: '/data' };

      await healPasses('App');

      expect(stubs.dockerService.appDockerForceRemove.called, 'must not remove what it cannot recreate').to.be.false;
      expect(stubs.appUninstaller.removeAppLocally.called).to.be.false;
      const blocked = stubs.log.error.getCalls().some((c) => /must NOT be recreated/.test(c.args[0]));
      expect(blocked, 'says loudly why it refused').to.be.true;
    });

    it('refuses to destroy a container whose data volume cannot be verified', async () => {
      // the recreate is soft-only, so an unverifiable volume means it would fail
      // AFTER the container was destroyed
      stubs.volumeService.verifyAppVolumeMount.resolves(false);

      await healPasses();

      expect(stubs.dockerService.appDockerForceRemove.called, 'a container whose volume cannot be verified must be left alone').to.be.false;
      expect(stubs.containerHealthMonitor.recreateMissingContainers.called).to.be.false;
    });

    it('aborts the remove if another operation took the container over during the confirmation', async () => {
      // isManagedElsewhere is sampled at reconcile entry, but the heal spends seconds
      // confirming - a redeploy/backup starting in that window must not have its
      // container force-removed underneath it.
      await appReconciler.reconcile('www_App'); // opens the persistence window
      clock.tick(61 * 1000);
      stubs.serviceHelper.delay.callsFake(async () => {
        stubs.globalState.isOperationInProgress = () => true; // a redeploy starts mid-settle
      });

      await appReconciler.reconcile('www_App');

      expect(stubs.dockerService.appDockerForceRemove.called, 'must not actuate on a container another subsystem owns').to.be.false;
    });

    it('does not rebuild the whole node when many containers look detached at once', async () => {
      // a dockerd restart can serve inspects before libnetwork restores endpoint IPs,
      // and the reconnect sweep enqueues everything at that moment
      localSpec = {
        name: 'App',
        version: 4,
        compose: [{ name: 'www', containerData: '/data' }, { name: 'api', containerData: '/data' }, { name: 'db', containerData: '/data' }],
      };

      await appReconciler.reconcile('www_App');
      await appReconciler.reconcile('api_App');
      await appReconciler.reconcile('db_App');
      clock.tick(61 * 1000);
      await appReconciler.reconcile('www_App');
      await appReconciler.reconcile('api_App');
      await appReconciler.reconcile('db_App');

      expect(stubs.dockerService.appDockerForceRemove.called, 'a node-wide detach is a docker fault, not N stale endpoints').to.be.false;
      const storm = stubs.log.error.getCalls().some((c) => /docker-level fault/.test(c.args[0]));
      expect(storm, 'says loudly that it refused a node-wide rebuild').to.be.true;
    });

    it('does not destroy the container when docker confirms its network is gone (records network_pruned)', async () => {
      stubs.dockerService.dockerNetworkState.resolves('absent');
      await healPasses();
      expect(stubs.dockerService.appDockerForceRemove.called, 'must not remove a container it cannot recreate').to.be.false;
      expect(stubs.containerHealthMonitor.recreateMissingContainers.called).to.be.false;
      const pruned = stubs.appTamperingDetectionService.recordEvent.getCalls().some((c) => c.args[1] === 'network_pruned');
      expect(pruned, 'records a network_pruned event').to.be.true;
    });

    it('defers (destroys nothing, records nothing) when docker cannot say whether the network exists', async () => {
      stubs.dockerService.dockerNetworkState.resolves('unknown');
      await healPasses();
      expect(stubs.dockerService.appDockerForceRemove.called, 'an unreadable network is not a missing network').to.be.false;
      const pruned = stubs.appTamperingDetectionService.recordEvent.getCalls().some((c) => c.args[1] === 'network_pruned');
      expect(pruned, 'must not record a false network_pruned on a transient docker error').to.be.false;
    });

    it('paces heal attempts on its own durable ladder, not the crash-restart one', async () => {
      stubs.appsRuntimeState.networkHealWaitMs.resolves(30 * 1000); // the heal ladder says: not yet
      await healPasses();
      expect(stubs.dockerService.appDockerForceRemove.called, 'no destructive action while backing off').to.be.false;
      expect(stubs.appsRuntimeState.setNetworkHealRemoval.called).to.be.false;
      expect(
        stubs.appsRuntimeState.recordRestart.called,
        'a heal must not write to the crash ladder: it would hold down the container it just fixed',
      ).to.be.false;
    });

    it('does not remove the container if the heal cannot be recorded durably', async () => {
      // the durable flag is what stops a restart mid-heal from uninstalling the app,
      // and the ladder is what stops the retries hammering - without them, no remove
      stubs.appsRuntimeState.setNetworkHealRemoval.rejects(new Error('db unavailable'));

      await healPasses();

      expect(stubs.dockerService.appDockerForceRemove.called, 'an unrecordable heal must not happen at all').to.be.false;
      const noted = stubs.log.error.getCalls().some((c) => /cannot record the network heal/.test(c.args[0]));
      expect(noted, 'logs and retries rather than throwing out of reconcile').to.be.true;
    });

    it('restores monitoring when the force-remove itself fails', async () => {
      stubs.dockerService.appDockerForceRemove.rejects(new Error('device or resource busy'));
      await healPasses();
      expect(
        stubs.appInspector.startAppMonitoring.calledWith('www_App'),
        'the container is still there: it must not be left unmonitored',
      ).to.be.true;
      expect(stubs.appUninstaller.removeAppLocally.called).to.be.false;
    });

    it('a recreate failure retries, records the diagnostics, and never uninstalls the app', async () => {
      stubs.containerHealthMonitor.recreateMissingContainers.rejects(new Error('host port still in use'));
      await healPasses();
      expect(stubs.dockerService.appDockerForceRemove.called).to.be.true;
      expect(stubs.appUninstaller.removeAppLocally.called, 'a transient recreate failure must not uninstall').to.be.false;
      const failed = stubs.appTamperingDetectionService.recordEvent.getCalls().some((c) => c.args[1] === 'recreation_failed');
      expect(failed, 'a silently looping heal is an invisible outage: record the failure').to.be.true;
    });

    it('keeps retrying a broken heal at a bounded rate: no terminal give-up, no uninstall, one tamper event', async () => {
      stubs.containerHealthMonitor.recreateMissingContainers.rejects(new Error('host port still in use'));
      // the container stays "running" (inspect stub), so each pass re-enters the
      // running-detached branch - as the hourly sweep would drive it
      for (let i = 0; i < 8; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await appReconciler.reconcile('www_App');
        clock.tick(61 * 1000);
      }
      expect(stubs.appUninstaller.removeAppLocally.called, 'never uninstalls, however long it stays broken').to.be.false;
      expect(
        stubs.containerHealthMonitor.recreateMissingContainers.callCount,
        'keeps trying (paced by its ladder) rather than parking in a terminal state',
      ).to.be.at.least(6);
      // the durable tampering signal is recorded once per episode, not per attempt
      const detachedEvents = stubs.appTamperingDetectionService.recordEvent.getCalls().filter((c) => c.args[1] === 'network_detached').length;
      expect(detachedEvents, 'records network_detached once per episode, not per attempt').to.equal(1);
    });

    it('a FluxOS restart mid-heal still recreates: the absence is ours, not tampering', async () => {
      // fresh process: no in-memory heal state, container gone (removed just before
      // the crash), but the durable flag survived
      stubs.appsRuntimeState.isNetworkHealRemoval.resolves(true);
      stubs.dockerService.dockerContainerInspect.rejects(new Error('no such container'));
      stubs.dockerService.dockerListContainers.resolves([]); // docker up, container really absent
      stubs.containerHealthMonitor.recreateMissingContainers.rejects(new Error('host port still in use'));

      await appReconciler.reconcile('www_App');

      const vanished = stubs.appTamperingDetectionService.recordEvent.getCalls().some((c) => c.args[1] === 'container_vanished');
      expect(vanished, 'our own removal must not be recorded as tampering').to.be.false;
      expect(stubs.containerHealthMonitor.recreateMissingContainers.called, 'recreates on the heal path').to.be.true;
      expect(stubs.appUninstaller.removeAppLocally.called, 'a failed recreate must not uninstall the app').to.be.false;
    });

    it('defers instead of guessing when the durable heal flag cannot be read', async () => {
      // guessing "not a heal removal" is the destructive guess: it records a false
      // tampering event and can uninstall the app on a failed recreate
      stubs.appsRuntimeState.isNetworkHealRemoval.rejects(new Error('db unavailable'));
      stubs.dockerService.dockerContainerInspect.rejects(new Error('no such container'));
      stubs.dockerService.dockerListContainers.resolves([]);

      await appReconciler.reconcile('www_App');

      expect(stubs.containerHealthMonitor.recreateMissingContainers.called, 'no recreate on an unreadable state').to.be.false;
      expect(stubs.appUninstaller.removeAppLocally.called, 'and above all, no uninstall').to.be.false;
      const vanished = stubs.appTamperingDetectionService.recordEvent.getCalls().some((c) => c.args[1] === 'container_vanished');
      expect(vanished, 'no false tampering event').to.be.false;
    });

    it('a container that vanished on its own (no heal flag) still takes the vanished path', async () => {
      stubs.appsRuntimeState.isNetworkHealRemoval.resolves(false);
      stubs.dockerService.dockerContainerInspect.rejects(new Error('no such container'));
      stubs.dockerService.dockerListContainers.resolves([]);

      await appReconciler.reconcile('www_App');

      const vanished = stubs.appTamperingDetectionService.recordEvent.getCalls().some((c) => c.args[1] === 'container_vanished');
      expect(vanished, 'a genuine vanish is still a tampering signal').to.be.true;
    });
  });

  describe('post-start attachment verification', () => {
    it('re-checks a container shortly after starting it, instead of waiting for the hourly sweep', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        await appReconciler.reconcile('www_App'); // stopped -> start
        expect(stubs.dockerService.appDockerStart.calledOnce).to.be.true;
        const inspectsAfterStart = stubs.dockerService.dockerContainerInspect.callCount;

        clock.tick(30 * 1000); // the post-start verification pass
        await new Promise((resolve) => { setImmediate(resolve); });

        expect(
          stubs.dockerService.dockerContainerInspect.callCount,
          'the start is when a container can come up detached, so it must be looked at again',
        ).to.be.above(inspectsAfterStart);
      } finally {
        clock.restore();
      }
    });
  });
});
