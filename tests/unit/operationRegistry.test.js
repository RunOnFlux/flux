const { expect } = require('chai');
const operationRegistry = require('../../ZelBack/src/services/utils/operationRegistry');

describe('operationRegistry tests', () => {
  afterEach(() => operationRegistry.clear());

  it('lets one operation hold an app at a time', () => {
    const token = operationRegistry.acquire('app1', 'backup', 'test');

    expect(token).to.be.a('string');
    expect(operationRegistry.acquire('app1', 'restore', 'test')).to.equal(null);
    expect(operationRegistry.acquire('app1', 'backup', 'test')).to.equal(null);
    expect(operationRegistry.get('app1')).to.deep.equal({ type: 'backup', owner: 'test' });
    expect(operationRegistry.acquire('app2', 'restore', 'test')).to.be.a('string');
  });

  it('releases only for the token that took the lease', () => {
    const token = operationRegistry.acquire('app1', 'backup', 'test');

    expect(operationRegistry.release('app1', 'lease-other')).to.equal(false);
    expect(operationRegistry.release('app1', null)).to.equal(false);
    expect(operationRegistry.isHeld('app1')).to.equal(true);
    expect(operationRegistry.release('app1', token)).to.equal(true);
    expect(operationRegistry.isHeld('app1')).to.equal(false);
  });

  it('lists the apps each type holds', () => {
    operationRegistry.acquire('app1', 'backup', 'test');
    operationRegistry.acquire('app2', 'restore', 'test');
    operationRegistry.acquire('app3', 'backup', 'test');

    expect(operationRegistry.listByType('backup')).to.deep.equal(['app1', 'app3']);
    expect(operationRegistry.listByType('restore')).to.deep.equal(['app2']);
  });

  it('resolves a wait for the release when the holder releases, and at once when none holds', async () => {
    await operationRegistry.whenReleased('free');
    const token = operationRegistry.acquire('app1', 'backup', 'test');
    let released = false;
    const waiting = operationRegistry.whenReleased('app1').then(() => { released = true; });

    await Promise.resolve();
    expect(released).to.equal(false);
    operationRegistry.release('app1', token);
    await waiting;
    expect(released).to.equal(true);
  });

  it('stops a holder through its signal, naming what it stops for', () => {
    const token = operationRegistry.acquire('app1', 'backup', 'test');
    const signal = operationRegistry.signalOf('app1', token);

    expect(operationRegistry.signalOf('app1', 'lease-other')).to.equal(null);
    expect(() => operationRegistry.throwIfPreempted(signal)).to.not.throw();
    expect(operationRegistry.preempt('app1', 'removal')).to.equal(true);
    expect(signal.aborted).to.equal(true);
    expect(() => operationRegistry.throwIfPreempted(signal))
      .to.throw(operationRegistry.OperationPreemptedError, 'app1: stopped for its removal');
    expect(operationRegistry.preempt('free', 'removal')).to.equal(false);
  });
});
