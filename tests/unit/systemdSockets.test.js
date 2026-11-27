const { expect } = require('chai');
const sinon = require('sinon');
const log = require('../../ZelBack/src/lib/log');
const { passedSockets } = require('../../ZelBack/src/services/utils/systemdSockets');

describe('systemdSockets tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('passes nothing when systemd passed nothing', () => {
    expect(passedSockets({}, 42).size).to.equal(0);
  });

  it('takes no socket passed to another process', () => {
    const env = { LISTEN_PID: '99', LISTEN_FDS: '1', LISTEN_FDNAMES: 'fluxos-node-service' };
    expect(passedSockets(env, 42).size).to.equal(0);
    expect(passedSockets({ LISTEN_FDS: '1', LISTEN_FDNAMES: 'fluxos-node-service' }, 42).size).to.equal(0);
  });

  it('names each socket in file descriptor order from 3', () => {
    const env = { LISTEN_PID: '42', LISTEN_FDS: '2', LISTEN_FDNAMES: 'fluxos-node-service:other' };
    expect([...passedSockets(env, 42)]).to.deep.equal([['fluxos-node-service', 3], ['other', 4]]);
  });

  it('refuses a handover whose names do not match its sockets', () => {
    sinon.stub(log, 'error');
    expect(passedSockets({ LISTEN_PID: '42', LISTEN_FDS: '2', LISTEN_FDNAMES: 'one' }, 42).size).to.equal(0);
    expect(passedSockets({ LISTEN_PID: '42', LISTEN_FDS: '2', LISTEN_FDNAMES: 'a:a' }, 42).size).to.equal(0);
    expect(passedSockets({ LISTEN_PID: '42', LISTEN_FDS: 'x', LISTEN_FDNAMES: 'a' }, 42).size).to.equal(0);
    sinon.assert.calledTwice(log.error);
  });
});
