const { expect } = require('chai');
const { wellFormed, isAppRunningEntry, FIXED_SIZE_MAX_BYTES } = require('../../ZelBack/src/services/utils/broadcastShape');

const without = (data, field) => Object.fromEntries(Object.entries(data).filter(([key]) => key !== field));

describe('broadcastShape', () => {
  const broadcastedAt = 1793960000000;
  const ip = '1.2.3.4:16127';
  const running = {
    type: 'fluxapprunning', version: 2, ip, broadcastedAt, osUptime: 10, staticIp: true, apps: [{ name: 'a', hash: 'h', runningSince: '2026-11-01T00:00:00.000Z' }],
  };
  const shapes = {
    running,
    installing: {
      type: 'fluxappinstalling', version: 1, ip, broadcastedAt, name: 'a',
    },
    'install error': {
      type: 'fluxappinstallingerror', version: 1, ip, broadcastedAt, name: 'a', hash: 'h', error: 'failed',
    },
    removed: {
      type: 'fluxappremoved', version: 1, ip, broadcastedAt, appName: 'a',
    },
    'removed together': {
      type: 'fluxappremoved', version: 2, ip, broadcastedAt, apps: ['a', 'b'],
    },
    sigterm: {
      type: 'fluxnodesigterm', version: 1, ip, broadcastedAt,
    },
    'ip changed': {
      type: 'fluxipchanged', version: 1, oldIP: ip, newIP: '1.2.3.5:16127', broadcastedAt,
    },
  };

  it('refuses a version 1 running message, which names one app', () => {
    expect(wellFormed({
      type: 'fluxapprunning', version: 1, ip, broadcastedAt, name: 'a', hash: 'h',
    })).to.equal(false);
  });

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
    ['a running message with a field no running message carries', { ...running, runningSince: '2026-11-01T00:00:00.000Z' }],
    ['a running message without its uptime', without(running, 'osUptime')],
    ['a running message without its static flag', without(running, 'staticIp')],
    ['an app whose running time is not text', { ...running, apps: [{ name: 'a', hash: 'h', runningSince: 5 }] }],
    ['an app without a hash', { ...running, apps: [...running.apps, { name: 'b', runningSince: '2026-11-01T00:00:00.000Z' }] }],
    ['an app with an empty hash', { ...running, apps: [{ ...running.apps[0], hash: '' }] }],
    ['an app with a field no app carries', { ...running, apps: [{ ...running.apps[0], extra: 1 }] }],
    ['an app that is not an object', { ...running, apps: [...running.apps, 'b'] }],
    ['a running message naming more apps than a node may hold', { ...running, apps: Array.from({ length: 201 }, () => running.apps[0]) }],
    ['a version 1 removal with a field no removal carries', { ...shapes.removed, apps: 'x' }],
    ['a version 1 removal naming its app as a list', { ...shapes.removed, apps: ['a'] }],
    ['a version 2 removal with a field no removal carries', { ...shapes['removed together'], appName: 'a' }],
    ['a removal of an unknown version', { ...shapes.removed, version: 3 }],
    ['apps that are not a list', { ...running, apps: {} }],
    ['an unknown version', { ...running, version: 3 }],
    ['an install error that is not text', { ...shapes['install error'], error: { $add: [1, 2] } }],
    ['a removal naming no app', { ...shapes['removed together'], apps: [] }],
    ['a removal naming an app that is not text', { ...shapes['removed together'], apps: ['a', { $ne: '' }] }],
    ['a removal naming more apps than a node may hold', { ...shapes['removed together'], apps: Array.from({ length: 201 }, (_, i) => `app${i}`) }],
  ].forEach(([name, data]) => {
    it(`refuses ${name}`, () => {
      expect(wellFormed(data)).to.equal(false);
    });
  });

  it('takes an app entry that is exactly a name, a hash and a running time, and no other', () => {
    expect(isAppRunningEntry(running.apps[0])).to.equal(true);
    expect(isAppRunningEntry({ name: 'a', hash: 'h' })).to.equal(false);
    expect(isAppRunningEntry(null)).to.equal(false);
    expect(isAppRunningEntry(['a', 'h', 't'])).to.equal(false);
  });

  // grown by a field of its own where the message may carry one, and by its app's
  // name where it carries exactly its fields
  [['sigterm', 'padding'], ['removed', 'appName'], ['ip changed', 'padding']].forEach(([name, field]) => {
    it(`refuses a ${name} message over the fixed size, and takes one at it`, () => {
      const data = shapes[name];
      const grown = (extra) => ({ ...data, [field]: `${data[field] ?? ''}${extra}` });
      const room = FIXED_SIZE_MAX_BYTES - JSON.stringify(grown('')).length;
      expect(wellFormed(grown('x'.repeat(room)))).to.equal(true);
      expect(wellFormed(grown('x'.repeat(room + 1)))).to.equal(false);
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
