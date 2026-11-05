const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { expect } = require('chai');
const sinon = require('sinon');

const portFile = require('../../ZelBack/src/services/utils/portFile');
const publicPorts = require('../../ZelBack/src/services/utils/publicPorts');

const settle = () => new Promise((resolve) => { setTimeout(resolve, 100); });

describe('publicPorts tests', () => {
  const before = process.env.FLUXOS_API_SOCKET;
  let dir;
  let file;
  let written;

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
    publish({
      uiPort: 16136, apiPort: 16137, apiPortHttps: 16138, alsoServing: [16127],
    });
    await settle();
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
    publish({
      uiPort: 16146, apiPort: 16147, apiPortHttps: 16148, alsoServing: [],
    });
    await settle();
    sinon.assert.calledTwice(moved);
    expect(publicPorts.getAlsoServing()).to.deep.equal([]);
    publicPorts.offChange(moved);
  });

  it('does not count a rewrite of the same ports as a move', async () => {
    const moved = sinon.stub();
    publicPorts.onChange(moved);
    publish({ uiPort: 16126, apiPort: 16127, apiPortHttps: 16128 });
    await publicPorts.start({ file });
    publish({
      uiPort: 16126, apiPort: 16127, apiPortHttps: 16128, alsoServing: [],
    });
    await settle();
    sinon.assert.calledOnce(moved);
    publicPorts.offChange(moved);
  });

  it('keeps the ports it has when the file stops being readable', async () => {
    publish({ uiPort: 16126, apiPort: 16127, apiPortHttps: 16128 });
    await publicPorts.start({ file });
    fs.writeFileSync(`${file}.tmp`, 'nonsense');
    fs.renameSync(`${file}.tmp`, file);
    await settle();
    expect(publicPorts.getApiPort()).to.equal(16127);
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

  it('waits for the proxy\'s directory', async () => {
    const later = path.join(dir, 'later');
    await publicPorts.start({ file: path.join(later, 'ports.json') });
    expect(publicPorts.getApiPort()).to.equal(16147);
  });
});
