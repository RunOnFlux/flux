const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('spawnerControl', () => {
  let control;
  let passes;
  let stopsHeard;

  // A runner that counts its passes and reports how the spawner's stop reached it.
  async function runner() {
    passes += 1;
    const attempt = control.beginAttempt();
    try {
      await attempt.sleep(60000);
    } catch (error) {
      if (error instanceof control.SpawnerStopped) stopsHeard += 1;
      return 0;
    } finally {
      attempt.end();
    }
    return 60000;
  }

  const settle = () => new Promise((resolve) => { setImmediate(resolve); });

  beforeEach(() => {
    control = proxyquire('../../ZelBack/src/services/utils/spawnerControl', {});
    passes = 0;
    stopsHeard = 0;
    control.setRunner(runner);
  });

  afterEach(async () => {
    await control.setReady(false);
  });

  it('runs once the node is ready, and stops with its attempt when readiness is lost', async () => {
    await control.setReady(true);
    await settle();
    expect(passes).to.equal(1);

    await control.setReady(false);
    await settle();

    expect(stopsHeard, 'the attempt in flight was not stopped').to.equal(1);
    expect(passes).to.equal(1);
  });

  it('stops for a move that is due, stays stopped while it is, and starts again once it is not', async () => {
    await control.setReady(true);
    await settle();

    await control.setMoveDue(true);
    await settle();
    expect(stopsHeard, 'the attempt in flight was not stopped').to.equal(1);
    expect(passes, 'a pass ran while the move was due').to.equal(1);

    await control.setMoveDue(false);
    await settle();
    expect(passes, 'the spawner did not start again once the move was handled').to.equal(2);
  });

  it('does not start after a move while the node is not ready', async () => {
    await control.setMoveDue(true);
    await control.setMoveDue(false);
    await settle();

    expect(passes).to.equal(0);
  });

  it('does not start when the node becomes ready while a move is due, and starts once it is not', async () => {
    await control.setMoveDue(true);
    await control.setReady(true);
    await settle();
    expect(passes, 'the spawner ran while the move was due').to.equal(0);

    await control.setMoveDue(false);
    await settle();

    expect(passes).to.equal(1);
  });

  // A stop waits for an install holding the lock; a ready signal that arrives
  // meanwhile is not lost.
  it('waits for an install under way, and starts once it has let go when the node became ready meanwhile', async () => {
    await control.setReady(true);
    await settle();
    const attempt = control.beginAttempt();
    const letGo = attempt.holdForInstall();
    let stopped = false;

    const stopping = control.setReady(false).then(() => { stopped = true; });
    await settle();
    expect(stopped, 'the stop did not wait for the install').to.equal(false);
    await control.setReady(true);
    letGo();
    await stopping;
    await settle();
    attempt.end();

    expect(passes, 'the ready signal given during the stop was lost').to.equal(2);
  });

  it('lets an install\'s lock go once, however often it is told to', async () => {
    await control.setReady(true);
    await settle();
    const first = control.beginAttempt().holdForInstall();
    first();
    const second = control.beginAttempt().holdForInstall();
    first();
    let stopped = false;

    const stopping = control.setReady(false).then(() => { stopped = true; });
    await settle();
    expect(stopped, 'letting the first install go again released the second').to.equal(false);
    second();
    await stopping;
  });

  it('installs nothing once a stop has begun', async () => {
    await control.setReady(true);
    await settle();
    const installing = control.beginAttempt();
    const deciding = control.beginAttempt();
    const holding = installing.holdForInstall();
    const stopping = control.setReady(false);
    await settle();

    expect(() => deciding.holdForInstall()).to.throw(control.SpawnerStopped);
    holding();
    await stopping;
  });

  // An attempt busy elsewhere (a port test, a registry read) when it is stopped
  // reaches its install and its waits only after the stop has finished.
  it('installs nothing and waits for nothing in an attempt stopped while it was busy, after the stop has finished', async () => {
    await control.setReady(true);
    await settle();
    const busy = control.beginAttempt();

    await control.setReady(false);
    await control.setReady(true);
    await settle();

    expect(() => busy.holdForInstall(), 'the stopped attempt installed').to.throw(control.SpawnerStopped);
    let slept = null;
    await busy.sleep(1).then(() => { slept = true; }, (error) => { slept = error; });
    expect(slept, 'the stopped attempt waited on').to.be.instanceOf(control.SpawnerStopped);
    busy.end();
  });

  it('ends an attempt deciding on an app when that app is installed by another route, and starts again', async () => {
    await control.setReady(true);
    await settle();
    const deciding = control.beginAttempt();
    deciding.forApp('SomeApp');

    await control.stopAttemptFor('someapp');
    await settle();

    expect(() => deciding.holdForInstall(), 'the attempt installed an app the node was installing').to.throw(control.SpawnerStopped);
    expect(stopsHeard, 'the waiting attempt was not ended').to.equal(1);
    expect(passes, 'the spawner did not decide afresh').to.equal(2);
    deciding.end();
  });

  it('leaves an attempt for another app, and one already installing its app, to carry on', async () => {
    await control.setReady(true);
    await settle();
    const other = control.beginAttempt();
    other.forApp('otherapp');
    const installing = control.beginAttempt();
    installing.forApp('someapp');
    const letGo = installing.holdForInstall();

    await control.stopAttemptFor('someapp');
    await settle();

    expect(stopsHeard, 'the spawner was stopped').to.equal(0);
    expect(passes).to.equal(1);
    const otherLetGo = other.holdForInstall();
    otherLetGo();
    letGo();
    other.end();
    installing.end();
  });
});
