const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { expect } = require('chai');

const fluxosTrial = require('../../ZelBack/src/services/utils/fluxosTrial');

describe('fluxosTrial tests', () => {
  const before = process.env.FLUXOS_API_SOCKET;
  let dir;
  let file;

  beforeEach(() => {
    process.env.FLUXOS_API_SOCKET = '/run/fluxos/api.sock';
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-'));
    file = path.join(dir, 'fluxos-trial');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (before === undefined) delete process.env.FLUXOS_API_SOCKET;
    else process.env.FLUXOS_API_SOCKET = before;
  });

  it('holds nothing with no trial open', async () => {
    await fluxosTrial.settled({ file });
  });

  it('holds until the trial ends', async () => {
    fs.writeFileSync(file, '');
    let done = false;
    const waiting = fluxosTrial.settled({ file }).then(() => { done = true; });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(done).to.equal(false);
    fs.unlinkSync(file);
    await waiting;
    expect(done).to.equal(true);
  });

  it('holds nothing off the socket, whatever is on disk', async () => {
    delete process.env.FLUXOS_API_SOCKET;
    fs.writeFileSync(file, '');
    await fluxosTrial.settled({ file });
  });
});
