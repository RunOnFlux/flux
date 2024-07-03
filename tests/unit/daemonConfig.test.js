const chai = require('chai');

const { expect } = chai;

const sinon = require('sinon');

const os = require('node:os');
const fs = require('node:fs/promises');

const fluxdConfigs = require('./data/fluxdConfigs');
const { DaemonConfig } = require('../../ZelBack/src/services/utils/daemonConfig');

describe('daemonConfig tests', () => {
  const hostPlatform = process.platform;
  const homedir = '/home/testuser';

  function setPlatform(platform) {
    Object.defineProperty(process, 'platform', { value: platform });
  }
  beforeEach(async () => {
    sinon.stub(os, 'homedir').returns(homedir);
  });

  afterEach(() => {
    setPlatform(hostPlatform);
    process.env.APPDATA = undefined;
    sinon.restore();
  });

  it('should instantiate and set correct basedir for each supported platform', () => {
    process.env.APPDATA = 'C:\testappdata';

    const platforms = ['linux', 'darwin', 'win32'];
    const basedirs = ['/home/testuser', '/home/testuser/Library/Application Support', 'C:\testappdata'];

    platforms.forEach((platform, index) => {
      setPlatform(platform);
      const dc = new DaemonConfig();
      expect(dc.resolveAttempted).to.equal(false);
      expect(dc.baseDir).to.equal(basedirs[index]);
    });
  });

  it('should instantiate and return null for config params', () => {
    setPlatform('linux');

    const dc = new DaemonConfig();
    expect(dc.rpcuser).to.equal(null);
    expect(dc.rpcpassword).to.equal(null);
    expect(dc.rpcport).to.equal(null);
    expect(dc.configDir).to.equal(null);
    expect(dc.configPath).to.equal(null);
  });

  it('should set correct paths if flux exists', async () => {
    setPlatform('linux');
    sinon.stub(fs, 'stat').resolves({ statresult: true });

    const dc = new DaemonConfig();
    await dc.resolvePaths();

    expect(dc.pathResolved).to.equal(true);
    expect(dc.configPath).to.equal('/home/testuser/.flux/flux.conf');
    expect(dc.configDir).to.equal('/home/testuser/.flux');
  });

  it('should set correct paths if flux doesn\'t exist and zel does', async () => {
    setPlatform('linux');
    sinon.stub(fs, 'stat').callsFake(async (path) => {
      if (path.includes('flux')) {
        throw (new Error('Not found'));
      }

      return { Found: true };
    });

    const dc = new DaemonConfig();
    await dc.resolvePaths();

    expect(dc.pathResolved).to.equal(true);
    expect(dc.configPath).to.equal('/home/testuser/.zelcash/zelcash.conf');
    expect(dc.configDir).to.equal('/home/testuser/.zelcash');
  });

  it('should not set any paths if flux or zel doesn\'t exist', async () => {
    setPlatform('linux');
    sinon.stub(fs, 'stat').rejects(new Error('Not found'));

    const dc = new DaemonConfig();
    await dc.resolvePaths();

    expect(dc.pathResolved).to.equal(false);
    expect(dc.unresolvable).to.equal(true);
    expect(dc.configPath).to.equal(null);
    expect(dc.configDir).to.equal(null);
  });

  it('should parse a standard fluxd config file correctly', async () => {
    setPlatform('linux');
    sinon.stub(fs, 'stat').resolves({ found: true });
    const readStub = sinon.stub(fs, 'readFile').resolves(fluxdConfigs.standard);

    const dc = new DaemonConfig();
    await dc.resolvePaths();
    await dc.parseConfig();

    sinon.assert.calledOnce(readStub);
    expect(dc.rpcuser).to.equal('testuser');
    expect(dc.rpcpassword).to.equal('testpassword12345');
    expect(dc.rpcport).to.equal('16124');
    expect(dc.configElements).to.deep.equal(fluxdConfigs.standardParsed);
  });

  it('should write the same config file that it parsed including comments', async () => {
    setPlatform('linux');
    sinon.stub(fs, 'stat').resolves({ found: true });
    const readStub = sinon.stub(fs, 'readFile').resolves(fluxdConfigs.withComments);
    const writeStub = sinon.stub(fs, 'writeFile').resolves();

    const dc = new DaemonConfig();
    await dc.resolvePaths();
    await dc.parseConfig();

    sinon.assert.calledOnce(readStub);
    expect(dc.configElements).to.deep.equal(fluxdConfigs.withCommentsParsed);

    await dc.write();

    sinon.assert.calledOnceWithExactly(writeStub, '/home/testuser/.flux/flux.conf', fluxdConfigs.withComments);
  });

  it('should write the same config file that it parsed excluding empty lines', async () => {
    setPlatform('linux');
    sinon.stub(fs, 'stat').resolves({ found: true });
    const readStub = sinon.stub(fs, 'readFile').resolves(fluxdConfigs.withWhitespace);
    const writeStub = sinon.stub(fs, 'writeFile').resolves();

    const dc = new DaemonConfig();
    await dc.resolvePaths();
    await dc.parseConfig();

    sinon.assert.calledOnce(readStub);
    expect(dc.configElements).to.deep.equal(fluxdConfigs.withWhitespaceParsed);

    await dc.write();

    sinon.assert.calledOnceWithExactly(writeStub, '/home/testuser/.flux/flux.conf', fluxdConfigs.withWhitespaceRemoved);
  });

  it('should add new string options to config file', async () => {
    const topics = [
      'zmqpubhashtx',
      'zmqpubhashblock',
      'zmqpubrawblock',
      'zmqpubrawtx',
      'zmqpubsequence',
    ];
    const endpoint = 'tcp://127.0.0.1:16126';

    setPlatform('linux');
    sinon.stub(fs, 'stat').resolves({ found: true });
    const readStub = sinon.stub(fs, 'readFile').resolves(fluxdConfigs.withWhitespace);
    const writeStub = sinon.stub(fs, 'writeFile').resolves();

    const dc = new DaemonConfig();
    await dc.resolvePaths();
    await dc.parseConfig();

    sinon.assert.calledOnce(readStub);
    expect(dc.configElements).to.deep.equal(fluxdConfigs.withWhitespaceParsed);

    topics.forEach((topic) => {
      dc.set(topic, endpoint);
    });

    await dc.write();

    sinon.assert.calledOnceWithExactly(writeStub, '/home/testuser/.flux/flux.conf', fluxdConfigs.withOptionsAdded);
  });

  it('should update existing string options in config file', async () => {
    const topics = [
      'zmqpubhashtx',
      'zmqpubhashblock',
      'zmqpubrawblock',
      'zmqpubrawtx',
      'zmqpubsequence',
    ];
    const endpoint = 'tcp://127.0.0.1:33333';
    const replace = true;

    setPlatform('linux');
    sinon.stub(fs, 'stat').resolves({ found: true });
    const readStub = sinon.stub(fs, 'readFile').resolves(fluxdConfigs.withWhitespace);
    const writeStub = sinon.stub(fs, 'writeFile').resolves();

    const dc = new DaemonConfig();
    await dc.resolvePaths();
    await dc.parseConfig();

    sinon.assert.calledOnce(readStub);
    expect(dc.configElements).to.deep.equal(fluxdConfigs.withWhitespaceParsed);

    topics.forEach((topic) => {
      dc.set(topic, endpoint, replace);
    });

    await dc.write();

    sinon.assert.calledOnceWithExactly(writeStub, '/home/testuser/.flux/flux.conf', fluxdConfigs.withOptionsUpdated);
  });

  it('should add new array options to config file', async () => {
    const optionName = 'testOption';
    const optionsvalues = ['a', 'b', 'c', 'd'];

    setPlatform('linux');
    sinon.stub(fs, 'stat').resolves({ found: true });
    const readStub = sinon.stub(fs, 'readFile').resolves(fluxdConfigs.withWhitespace);
    const writeStub = sinon.stub(fs, 'writeFile').resolves();

    const dc = new DaemonConfig();
    await dc.resolvePaths();
    await dc.parseConfig();

    sinon.assert.calledOnce(readStub);
    expect(dc.configElements).to.deep.equal(fluxdConfigs.withWhitespaceParsed);

    optionsvalues.forEach((option) => {
      dc.set(optionName, option);
    });

    await dc.write();

    sinon.assert.calledOnceWithExactly(writeStub, '/home/testuser/.flux/flux.conf', fluxdConfigs.withMultiValueOptionsAdded);
  });

  it('should replace entire array options if requested', async () => {
    const optionName = 'addnode';
    const optionvalue = '1.2.3.4:1111';
    const replace = true;

    setPlatform('linux');
    sinon.stub(fs, 'stat').resolves({ found: true });
    const readStub = sinon.stub(fs, 'readFile').resolves(fluxdConfigs.standard);
    const writeStub = sinon.stub(fs, 'writeFile').resolves();

    const dc = new DaemonConfig();
    await dc.resolvePaths();
    await dc.parseConfig();

    sinon.assert.calledOnce(readStub);
    expect(dc.configElements).to.deep.equal(fluxdConfigs.standardParsed);

    dc.set(optionName, optionvalue, replace);

    await dc.write();

    sinon.assert.calledOnceWithExactly(writeStub, '/home/testuser/.flux/flux.conf', fluxdConfigs.withMultivalueOptionOverwritten);
  });

  it('should not add array item if it already exists', async () => {
    const optionName = 'addnode';
    const optionvalue = '202.61.236.202';

    setPlatform('linux');
    sinon.stub(fs, 'stat').resolves({ found: true });
    const readStub = sinon.stub(fs, 'readFile').resolves(fluxdConfigs.standard);
    const writeStub = sinon.stub(fs, 'writeFile').resolves();

    const dc = new DaemonConfig();
    await dc.resolvePaths();
    await dc.parseConfig();

    sinon.assert.calledOnce(readStub);
    expect(dc.configElements).to.deep.equal(fluxdConfigs.standardParsed);

    dc.set(optionName, optionvalue);

    await dc.write();

    sinon.assert.calledOnceWithExactly(writeStub, '/home/testuser/.flux/flux.conf', fluxdConfigs.standard);
  });

  it('should add array item if it doesn\'t already exists', async () => {
    const optionName = 'addnode';
    const optionvalue = '7.7.7.7';

    setPlatform('linux');
    sinon.stub(fs, 'stat').resolves({ found: true });
    const readStub = sinon.stub(fs, 'readFile').resolves(fluxdConfigs.standard);
    const writeStub = sinon.stub(fs, 'writeFile').resolves();

    const dc = new DaemonConfig();
    await dc.resolvePaths();
    await dc.parseConfig();

    sinon.assert.calledOnce(readStub);
    expect(dc.configElements).to.deep.equal(fluxdConfigs.standardParsed);

    dc.set(optionName, optionvalue);

    await dc.write();

    sinon.assert.calledOnceWithExactly(writeStub, '/home/testuser/.flux/flux.conf', fluxdConfigs.withArrayItemAdded);
  });

  it('should create backup file with original config, even after it has changed', async () => {
    const optionName = 'addnode';
    const optionvalue = '7.7.7.7';

    setPlatform('linux');
    sinon.stub(fs, 'stat').resolves({ found: true });
    const readStub = sinon.stub(fs, 'readFile').resolves(fluxdConfigs.standard);
    const writeStub = sinon.stub(fs, 'writeFile').resolves();

    const dc = new DaemonConfig();
    await dc.resolvePaths();
    await dc.parseConfig();

    sinon.assert.calledOnce(readStub);
    expect(dc.configElements).to.deep.equal(fluxdConfigs.standardParsed);

    dc.set(optionName, optionvalue);

    await dc.createBackupConfig('flux.conf.bak');

    sinon.assert.calledOnceWithExactly(writeStub, '/home/testuser/.flux/flux.conf.bak', fluxdConfigs.standard);
  });
});
