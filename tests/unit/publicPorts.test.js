const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { expect } = require('chai');
const sinon = require('sinon');

const portFile = require('../../ZelBack/src/services/utils/portFile');
const publicPorts = require('../../ZelBack/src/services/utils/publicPorts');

// Resolves on the listener's nth call.
const call = (listener, n) => new Promise((resolve) => { listener.onCall(n - 1).callsFake(resolve); });

// Resolves once every promise already settled has run its continuations.
const drained = () => new Promise((resolve) => { setImmediate(resolve); });

describe('publicPorts tests', () => {
  const before = process.env.FLUXOS_API_SOCKET;
  const userconfigBefore = globalThis.userconfig;
  let dir;
  let file;
  let written;

  // Resolves once the module has read the file and found this text in it.
  function readOf(text) {
    const read = fs.readFileSync;
    return new Promise((resolve) => {
      sinon.stub(fs, 'readFileSync').callsFake((...args) => {
        const content = read(...args);
        if (args[0] === file && content === text) resolve();
        return content;
      });
    });
  }

  function publish(ports) {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(ports));
    fs.renameSync(`${file}.tmp`, file);
  }

  beforeEach(() => {
    process.env.FLUXOS_API_SOCKET = '/run/fluxos/api.sock';
    globalThis.userconfig = { initial: { apiport: 16147 } };
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ports-'));
    file = path.join(dir, 'ports.json');
    written = sinon.stub(portFile, 'writePortFile').resolves(true);
  });

  afterEach(() => {
    publicPorts.stop();
    sinon.restore();
    globalThis.userconfig = userconfigBefore;
    fs.rmSync(dir, { recursive: true, force: true });
    if (before === undefined) delete process.env.FLUXOS_API_SOCKET;
    else process.env.FLUXOS_API_SOCKET = before;
  });

  it('gives the configured port until the proxy has published', () => {
    expect(publicPorts.getApiPort()).to.equal(16147);
  });

  it('publishes the ports it finds, with no ports before them', async () => {
    const moved = sinon.stub();
    publicPorts.onChange(moved);
    publish({ uiPort: 16126, apiPort: 16127, apiPortHttps: 16128, alsoServing: [] });
    await publicPorts.start({ file });
    expect(publicPorts.getApiPort()).to.equal(16127);
    sinon.assert.calledOnce(written);
    sinon.assert.calledOnce(moved);
    expect(moved.firstCall.args[1]).to.equal(null);
    publicPorts.offChange(moved);
  });

  it('follows a change, telling the listener the new ports and the old', async () => {
    const moved = sinon.stub();
    publicPorts.onChange(moved);
    publish({ uiPort: 16126, apiPort: 16127, apiPortHttps: 16128 });
    await publicPorts.start({ file });
    const second = call(moved, 2);
    publish({
      uiPort: 16136, apiPort: 16137, apiPortHttps: 16138, alsoServing: [16127],
    });
    await second;
    sinon.assert.calledTwice(moved);
    expect(moved.secondCall.args[0].apiPort).to.equal(16137);
    expect(moved.secondCall.args[1].apiPort).to.equal(16127);
    expect(publicPorts.getApiPort()).to.equal(16137);
    publicPorts.offChange(moved);
  });

  it('tells of the end of a move and keeps the ports kept through it', async () => {
    const moved = sinon.stub();
    publicPorts.onChange(moved);
    publish({
      uiPort: 16146, apiPort: 16147, apiPortHttps: 16148, alsoServing: [16127],
    });
    await publicPorts.start({ file });
    expect(publicPorts.getAlsoServing()).to.deep.equal([16127]);
    const second = call(moved, 2);
    publish({
      uiPort: 16146, apiPort: 16147, apiPortHttps: 16148, alsoServing: [],
    });
    await second;
    sinon.assert.calledTwice(moved);
    expect(publicPorts.getAlsoServing()).to.deep.equal([]);
    publicPorts.offChange(moved);
  });

  it('does not count a rewrite of the same ports as a move', async () => {
    const moved = sinon.stub();
    publicPorts.onChange(moved);
    publish({ uiPort: 16126, apiPort: 16127, apiPortHttps: 16128 });
    await publicPorts.start({ file });
    const rewrite = {
      uiPort: 16126, apiPort: 16127, apiPortHttps: 16128, alsoServing: [],
    };
    const read = readOf(JSON.stringify(rewrite));
    publish(rewrite);
    await read;
    const second = call(moved, 2);
    publish({ uiPort: 16136, apiPort: 16137, apiPortHttps: 16138 });
    await second;
    sinon.assert.calledTwice(moved);
    expect(moved.secondCall.args[0].apiPort).to.equal(16137);
    publicPorts.offChange(moved);
  });

  it('keeps the ports it has when the file stops being readable', async () => {
    const moved = sinon.stub();
    publicPorts.onChange(moved);
    publish({ uiPort: 16126, apiPort: 16127, apiPortHttps: 16128 });
    await publicPorts.start({ file });
    const read = readOf('nonsense');
    fs.writeFileSync(`${file}.tmp`, 'nonsense');
    fs.renameSync(`${file}.tmp`, file);
    await read;
    expect(publicPorts.getApiPort()).to.equal(16127);
    const second = call(moved, 2);
    publish({ uiPort: 16136, apiPort: 16137, apiPortHttps: 16138 });
    await second;
    sinon.assert.calledTwice(moved);
    expect(moved.secondCall.args[1].apiPort).to.equal(16127);
    publicPorts.offChange(moved);
  });

  it('publishes the port the chain lists, once', async () => {
    publish({ uiPort: 16126, apiPort: 16127, apiPortHttps: 16128 });
    await publicPorts.start({ file });
    written.resetHistory();
    await publicPorts.setConfirmedApiPort('16127');
    await publicPorts.setConfirmedApiPort(16127);
    sinon.assert.calledOnce(written);
    expect(written.firstCall.args[0].confirmedApiPort).to.equal(16127);
  });

  it('resolves only once the proxy has published', async () => {
    let held = false;
    const started = publicPorts.start({ file }).then(() => { held = true; });
    await drained();
    expect(held).to.equal(false);
    publish({ uiPort: 16156, apiPort: 16157, apiPortHttps: 16158, alsoServing: [] });
    await started;
    expect(publicPorts.getApiPort()).to.equal(16157);
  });

  it('goes on waiting past a file it cannot read', async () => {
    fs.writeFileSync(file, 'not json');
    let held = false;
    const started = publicPorts.start({ file }).then(() => { held = true; });
    await drained();
    expect(held).to.equal(false);
    publish({ uiPort: 16126, apiPort: 16127, apiPortHttps: 16128, alsoServing: [] });
    await started;
  });
});
