const { expect } = require('chai');
const { wellFormed, FIXED_SIZE_MAX_BYTES } = require('../../ZelBack/src/services/utils/broadcastShape');

describe('broadcastShape', () => {
  const broadcastedAt = 1793960000000;
  const ip = '1.2.3.4:16127';
  const running = {
    type: 'fluxapprunning', version: 2, ip, broadcastedAt, osUptime: 10, staticIp: true, apps: [{ name: 'a', hash: 'h' }],
  };
  const shapes = {
    running,
    'running, version 1': {
      type: 'fluxapprunning', version: 1, ip, broadcastedAt, name: 'a', hash: 'h',
    },
    installing: {
      type: 'fluxappinstalling', version: 1, ip, broadcastedAt, name: 'a',
    },
    'install error': {
      type: 'fluxappinstallingerror', version: 1, ip, broadcastedAt, name: 'a', hash: 'h', error: 'failed',
    },
    removed: {
      type: 'fluxappremoved', version: 1, ip, broadcastedAt, appName: 'a',
    },
    sigterm: {
      type: 'fluxnodesigterm', version: 1, ip, broadcastedAt,
    },
    'ip changed': {
      type: 'fluxipchanged', version: 1, oldIP: ip, newIP: '1.2.3.5:16127', broadcastedAt,
    },
  };

  Object.entries(shapes).forEach(([name, data]) => {
    it(`takes a ${name} message`, () => {
      expect(wellFormed(data)).to.equal(true);
    });

    it(`refuses a ${name} message whose time is not a number`, () => {
      expect(wellFormed({ ...data, broadcastedAt: { $add: [1, 2] } })).to.equal(false);
    });
  });

  [
    ['an address that is not text', { ...running, ip: { $ne: '' } }],
    ['an uptime that is not a number', { ...running, osUptime: { $add: [1, 2] } }],
    ['a static flag that is not a flag', { ...running, staticIp: '$ip' }],
    ['a running time that is not a time', { ...running, runningSince: { $add: [1, 2] } }],
    ['an app whose running time is not a time', { ...running, apps: [{ name: 'a', hash: 'h', runningSince: {} }] }],
    ['apps that are not a list', { ...running, apps: {} }],
    ['an unknown version', { ...running, version: 3 }],
    ['an install error that is not text', { ...shapes['install error'], error: { $add: [1, 2] } }],
  ].forEach(([name, data]) => {
    it(`refuses ${name}`, () => {
      expect(wellFormed(data)).to.equal(false);
    });
  });

  it('leaves a running app it cannot store to the store, as one entry refused', () => {
    expect(wellFormed({ ...running, apps: [{ name: 1 }, { name: 'a', hash: 'h' }] })).to.equal(true);
  });

  ['sigterm', 'removed', 'ip changed'].forEach((name) => {
    it(`refuses a ${name} message over the fixed size, and takes one at it`, () => {
      const data = shapes[name];
      const room = FIXED_SIZE_MAX_BYTES - JSON.stringify({ ...data, padding: '' }).length;
      expect(wellFormed({ ...data, padding: 'x'.repeat(room) })).to.equal(true);
      expect(wellFormed({ ...data, padding: 'x'.repeat(room + 1) })).to.equal(false);
    });
  });

  describe('an app message', () => {
    const appMessage = {
      type: 'fluxappregister', version: 1, appSpecifications: { name: 'a' }, hash: 'a'.repeat(64), timestamp: broadcastedAt, signature: 'sig',
    };

    it('takes one, which carries no time of its own', () => {
      expect(wellFormed(appMessage)).to.equal(true);
      ['zelappregister', 'zelappupdate', 'fluxappupdate'].forEach((type) => expect(wellFormed({ ...appMessage, type }), type).to.equal(true));
    });

    [
      ['a hash that is a query', { hash: { $regex: '(a+)+$' } }],
      ['no hash', { hash: undefined }],
      ['a signature that is not text', { signature: { $ne: null } }],
      ['a version that is not a number', { version: '1' }],
      ['a time that is not a number', { timestamp: { $add: [1, 2] } }],
      ['no specification', { appSpecifications: null }],
    ].forEach(([name, change]) => {
      it(`refuses one with ${name}`, () => {
        expect(wellFormed({ ...appMessage, ...change })).to.equal(false);
      });
    });
  });

  it('holds no opinion of a type it does not know', () => {
    expect(wellFormed({ type: 'fluxapprequest', version: 1, hash: 'h' })).to.equal(true);
    expect(wellFormed({ type: 'constructor' })).to.equal(true);
  });
});
