const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('spawnerControl', () => {
  let control;
  let passes;
  let stopsHeard;

  // A runner that counts its passes and reports how the spawner's stop reached it.
  async function runner() {
    passes += 1;
    try {
      await control.sleep(60000);
    } catch (error) {
      if (error instanceof control.SpawnerStopped) stopsHeard += 1;
      return 0;
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

  it('stops for a move, and starts again after it while the node is ready', async () => {
    await control.setReady(true);
    await settle();
    let passesDuringMove = null;

    await control.duringMove(async () => {
      await settle();
      passesDuringMove = passes;
    });
    await settle();

    expect(stopsHeard).to.equal(1);
    expect(passesDuringMove, 'a pass ran during the move').to.equal(1);
    expect(passes, 'the spawner did not start again after the move').to.equal(2);
  });

  it('does not start after a move while the node is not ready', async () => {
    await control.duringMove(async () => {});
    await settle();

    expect(passes).to.equal(0);
  });

  it('does not start when the node becomes ready during a move, and starts once the move ends', async () => {
    await control.duringMove(async () => {
      await control.setReady(true);
      await settle();
      expect(passes, 'the spawner ran during the move').to.equal(0);
    });
    await settle();

    expect(passes).to.equal(1);
  });

  // A stop waits for an install holding the lock; a ready signal that arrives
  // meanwhile is not lost.
  it('waits for an install under way, and starts once it has let go when the node became ready meanwhile', async () => {
    await control.setReady(true);
    await settle();
    const letGo = control.holdForInstall();
    let stopped = false;

    const stopping = control.setReady(false).then(() => { stopped = true; });
    await settle();
    expect(stopped, 'the stop did not wait for the install').to.equal(false);
    await control.setReady(true);
    letGo();
    await stopping;
    await settle();

    expect(passes, 'the ready signal given during the stop was lost').to.equal(2);
  });

  it('installs nothing once a stop has begun', async () => {
    await control.setReady(true);
    await settle();
    const holding = control.holdForInstall();
    const stopping = control.setReady(false);
    await settle();

    expect(() => control.holdForInstall()).to.throw(control.SpawnerStopped);
    holding();
    await stopping;
  });
});
