// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const sinon = require('sinon');
const { createMonitorAccelerator } = require('../../ZelBack/src/services/appMonitoring/syncthingMonitorAccelerator');

describe('syncthingMonitorAccelerator tests', () => {
  let clock;
  let run;
  let inTransition;
  let accelerator;

  const DEBOUNCE = 2000;
  const MIN_GAP = 10000;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    run = sinon.stub();
    inTransition = sinon.stub().returns(false);
    accelerator = createMonitorAccelerator({
      run,
      isFolderInTransition: inTransition,
      debounceMs: DEBOUNCE,
      minGapMs: MIN_GAP,
    });
  });

  afterEach(() => {
    accelerator.stop();
    clock.restore();
  });

  it('ignores activity from folders not in transition', () => {
    accelerator.onFolderActivity('fluxsteady_app', 'FolderSummary');
    clock.tick(MIN_GAP * 3);
    sinon.assert.notCalled(run);
  });

  it('runs for a folder in transition, honoring the min gap from the last pass', () => {
    inTransition.returns(true);

    // a pass just completed
    accelerator.notePassStarted();
    accelerator.notePassEnded();

    accelerator.onFolderActivity('fluxsyncing_app', 'FolderSummary');
    clock.tick(MIN_GAP - 1);
    sinon.assert.notCalled(run);
    clock.tick(1);
    sinon.assert.calledOnce(run);
  });

  it('runs on FolderErrors regardless of transition state', () => {
    accelerator.notePassStarted();
    accelerator.notePassEnded();

    accelerator.onFolderActivity('fluxany_app', 'FolderErrors');
    clock.tick(MIN_GAP);
    sinon.assert.calledOnce(run);
  });

  it('waits only the debounce when the last pass ended long ago', () => {
    accelerator.notePassStarted();
    accelerator.notePassEnded();
    clock.tick(MIN_GAP * 2); // idle for a while

    accelerator.onFolderActivity('fluxany_app', 'FolderErrors');
    clock.tick(DEBOUNCE - 1);
    sinon.assert.notCalled(run);
    clock.tick(1);
    sinon.assert.calledOnce(run);
  });

  it('coalesces an event burst into one run', () => {
    accelerator.notePassStarted();
    accelerator.notePassEnded();
    clock.tick(MIN_GAP * 2);

    for (let i = 0; i < 25; i += 1) {
      accelerator.onFolderActivity('fluxany_app', 'FolderErrors');
    }
    clock.tick(MIN_GAP * 2);
    sinon.assert.calledOnce(run);
  });

  it('remembers a request landing during a pass and re-arms when the pass ends', () => {
    accelerator.notePassStarted();
    accelerator.onFolderActivity('fluxany_app', 'FolderErrors');
    clock.tick(MIN_GAP * 2); // nothing may fire while the pass runs
    sinon.assert.notCalled(run);

    accelerator.notePassEnded();
    clock.tick(MIN_GAP);
    sinon.assert.calledOnce(run);
  });

  it('stop() cancels a pending run', () => {
    accelerator.notePassStarted();
    accelerator.notePassEnded();
    accelerator.onFolderActivity('fluxany_app', 'FolderErrors');

    accelerator.stop();
    clock.tick(MIN_GAP * 3);
    sinon.assert.notCalled(run);
  });
});
