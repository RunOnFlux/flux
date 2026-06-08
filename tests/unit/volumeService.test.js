const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

chai.use(chaiAsPromised);
const { expect } = chai;

describe('volumeService tests', () => {
  describe('ensureMountPathsExist tests', () => {
    const APPS_FOLDER = '/test/apps/folder/';
    let dockerServiceStub;
    let serviceHelperStub;
    let mountParserStub;
    let fsStub;
    let logStub;
    let volumeService;

    beforeEach(() => {
      dockerServiceStub = { getAppIdentifier: sinon.stub() };
      // runCommand defaults to success ({ error: null }); tests override as needed
      serviceHelperStub = { runCommand: sinon.stub().resolves({ error: null, stdout: '', stderr: '' }) };
      mountParserStub = {
        parseContainerData: sinon.stub(),
        getRequiredLocalPaths: sinon.stub(),
        MountType: {
          PRIMARY: 'primary',
          DIRECTORY: 'directory',
          FILE: 'file',
          COMPONENT_PRIMARY: 'component_primary',
          COMPONENT_DIRECTORY: 'component_directory',
          COMPONENT_FILE: 'component_file',
        },
      };
      fsStub = { promises: { access: sinon.stub() } };
      logStub = {
        info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
      };

      volumeService = proxyquire('../../ZelBack/src/services/utils/volumeService', {
        '../dockerService': dockerServiceStub,
        '../serviceHelper': serviceHelperStub,
        './mountParser': mountParserStub,
        './appConstants': { appsFolder: APPS_FOLDER },
        '../../lib/log': logStub,
        fs: { promises: fsStub.promises },
      });
    });

    afterEach(() => {
      sinon.restore();
    });

    const callsFor = (cmd) => serviceHelperStub.runCommand.getCalls().filter((c) => c.args[0] === cmd);

    it('should skip creating paths that already exist', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'config.yaml', isFile: true },
      ]);
      fsStub.promises.access.resolves(); // every path exists

      await volumeService.ensureMountPathsExist({ name: 'webserver', containerData: '/data|f:config.yaml:/etc/config.yaml' }, 'testapp', true, null);

      expect(fsStub.promises.access.callCount).to.equal(2);
      expect(serviceHelperStub.runCommand.called).to.be.false; // nothing created
    });

    it('should create a missing file as root via touch + chmod (no shell, args passed as params)', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'config.yaml', isFile: true },
      ]);
      fsStub.promises.access.onFirstCall().resolves(); // appdata exists
      fsStub.promises.access.onSecondCall().rejects(new Error('ENOENT')); // config.yaml missing

      await volumeService.ensureMountPathsExist({ name: 'webserver', containerData: '/data|f:config.yaml:/etc/config.yaml' }, 'testapp', true, null);

      const expectedPath = `${APPS_FOLDER}fluxwebserver_testapp/config.yaml`;
      const touch = callsFor('touch');
      const chmod = callsFor('chmod');
      expect(callsFor('mkdir')).to.have.lengthOf(0); // files are not mkdir'd
      expect(touch).to.have.lengthOf(1);
      expect(touch[0].args[1]).to.include({ runAsRoot: true });
      expect(touch[0].args[1].params).to.deep.equal([expectedPath]);
      expect(chmod).to.have.lengthOf(1);
      expect(chmod[0].args[1].params).to.deep.equal(['777', expectedPath]);
    });

    it('should create a missing directory as root via mkdir -p', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'logs', isFile: false },
      ]);
      fsStub.promises.access.onFirstCall().resolves(); // appdata exists
      fsStub.promises.access.onSecondCall().rejects(new Error('ENOENT')); // logs missing

      await volumeService.ensureMountPathsExist({ name: 'webserver', containerData: '/data|m:logs:/var/log' }, 'testapp', true, null);

      const mkdir = callsFor('mkdir');
      expect(mkdir).to.have.lengthOf(1);
      expect(mkdir[0].args[1]).to.include({ runAsRoot: true });
      expect(mkdir[0].args[1].params).to.deep.equal(['-p', `${APPS_FOLDER}fluxwebserver_testapp/logs`]);
    });

    it('should create multiple missing files and directories', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([
        { name: 'appdata', isFile: false },
        { name: 'logs', isFile: false },
        { name: 'config.yaml', isFile: true },
        { name: 'cache', isFile: false },
      ]);
      fsStub.promises.access.onCall(0).resolves(); // appdata exists
      fsStub.promises.access.onCall(1).rejects(new Error('ENOENT')); // logs
      fsStub.promises.access.onCall(2).rejects(new Error('ENOENT')); // config.yaml
      fsStub.promises.access.onCall(3).rejects(new Error('ENOENT')); // cache

      await volumeService.ensureMountPathsExist({ name: 'webserver', containerData: '/data|m:logs:/var/log|f:config.yaml:/etc/config.yaml|m:cache:/var/cache' }, 'testapp', true, null);

      // logs (mkdir) + config.yaml (touch+chmod) + cache (mkdir) = 4 commands
      expect(serviceHelperStub.runCommand.callCount).to.equal(4);
      expect(callsFor('mkdir')).to.have.lengthOf(2);
      expect(callsFor('touch')).to.have.lengthOf(1);
      expect(callsFor('chmod')).to.have.lengthOf(1);
    });

    it('should construct the identifier correctly for non-component apps', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxtestapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([{ name: 'appdata', isFile: false }]);
      fsStub.promises.access.resolves();

      await volumeService.ensureMountPathsExist({ containerData: '/data' }, 'testapp', false, null);

      expect(dockerServiceStub.getAppIdentifier.calledWith('testapp')).to.be.true;
    });

    it('should throw when containerData parsing fails', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.throws(new Error('Invalid containerData syntax'));

      await expect(
        volumeService.ensureMountPathsExist({ name: 'webserver', containerData: 'invalid:syntax:extra' }, 'testapp', true, null),
      ).to.be.rejectedWith('Invalid containerData syntax');
    });

    it('should propagate a runCommand failure as a thrown error', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxwebserver_testapp');
      mountParserStub.parseContainerData.returns({ allMounts: [] });
      mountParserStub.getRequiredLocalPaths.returns([{ name: 'logs', isFile: false }]);
      fsStub.promises.access.rejects(new Error('ENOENT')); // missing → must create
      serviceHelperStub.runCommand.resolves({ error: new Error('mkdir failed'), stdout: '', stderr: '' });

      await expect(
        volumeService.ensureMountPathsExist({ name: 'webserver', containerData: '/data' }, 'testapp', true, null),
      ).to.be.rejectedWith('mkdir failed');
    });

    it('should ensure component-reference paths exist (and not create them when present)', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxbackup_testapp');
      mountParserStub.parseContainerData.returns({
        allMounts: [
          { type: 'primary', subdir: 'appdata', isFile: false },
          {
            type: 'component_primary', componentIndex: 0, subdir: 'appdata', isFile: false,
          },
        ],
      });
      mountParserStub.getRequiredLocalPaths.returns([{ name: 'appdata', isFile: false }]); // refs filtered out here
      fsStub.promises.access.resolves(); // local + reference paths exist

      const fullAppSpecs = { version: 4, compose: [{ name: 'db' }, { name: 'backup' }] };
      await volumeService.ensureMountPathsExist({ name: 'backup', containerData: '/data|0:/database' }, 'testapp', true, fullAppSpecs);

      expect(fsStub.promises.access.callCount).to.be.at.least(1);
      expect(serviceHelperStub.runCommand.called).to.be.false;
    });

    it('should throw when a component-reference mount has no full app specifications', async () => {
      dockerServiceStub.getAppIdentifier.returns('fluxbackup_testapp');
      mountParserStub.parseContainerData.returns({
        allMounts: [
          {
            type: 'component_primary', componentIndex: 0, subdir: 'appdata', containerPath: '/database', isFile: false,
          },
        ],
      });
      mountParserStub.getRequiredLocalPaths.returns([]);

      await expect(
        volumeService.ensureMountPathsExist({ name: 'backup', containerData: '/data|0:/database' }, 'testapp', true, null),
      ).to.be.rejectedWith('Component reference mount requires full app specifications');
    });
  });
});
