const path = require('node:path');

const { expect } = require('chai');

const runtimePaths = require('../../ZelBack/runtimePaths');

describe('runtimePaths tests', () => {
  const saved = { state: process.env.FLUXOS_STATE_PATH, logs: process.env.FLUXOS_LOG_PATH };

  afterEach(() => {
    process.env.FLUXOS_STATE_PATH = saved.state ?? '';
    process.env.FLUXOS_LOG_PATH = saved.logs ?? '';
  });

  it('keeps both in the checkout by default', () => {
    process.env.FLUXOS_STATE_PATH = '';
    process.env.FLUXOS_LOG_PATH = '';
    const checkout = path.join(__dirname, '../..');
    expect(runtimePaths.userconfigPath()).to.equal(path.join(checkout, 'config', 'userconfig.js'));
    expect(runtimePaths.logDir()).to.equal(checkout);
  });

  it('takes both from the unit when it names them', () => {
    process.env.FLUXOS_STATE_PATH = '/dat/var/lib/fluxos';
    process.env.FLUXOS_LOG_PATH = '/dat/var/log/fluxos';
    expect(runtimePaths.userconfigPath()).to.equal('/dat/var/lib/fluxos/userconfig.js');
    expect(runtimePaths.logDir()).to.equal('/dat/var/log/fluxos');
  });
});
