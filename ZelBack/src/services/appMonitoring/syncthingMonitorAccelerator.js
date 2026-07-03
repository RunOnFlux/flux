// Edge accelerator for the syncthing monitor. Folder-activity events request
// an early run of the same monitoring pass the interval drives - events never
// carry decisions. Two guards keep a continuous event stream (a large install
// sync, a busy app writing into its own folder) from degenerating into
// back-to-back full passes:
//   - activity only counts for folders the state machine is actively
//     transitioning, or for FolderErrors (syncthing's own signal that a
//     folder's storage went bad - e.g. the .stfolder marker vanished with its
//     mount); steady-state folders belong to the level pass
//   - early runs keep a minimum gap from the end of the last completed pass
// A request landing while a pass is running is remembered and re-armed when
// the pass ends. If the event stream dies entirely, behavior degrades to the
// interval cadence - latency, never correctness.

const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);

/**
 * @param {object} options
 * @param {Function} options.run Runs one monitoring pass (fire and forget).
 * @param {Function} options.isFolderInTransition (folderId) => boolean.
 * @param {number} options.debounceMs Coalescing window for event bursts.
 * @param {number} options.minGapMs Minimum gap from the last completed pass.
 * @returns {{onFolderActivity: Function, onResync: Function,
 *   notePassStarted: Function, notePassEnded: Function, stop: Function}}
 */
function createMonitorAccelerator({
  run, isFolderInTransition, debounceMs, minGapMs,
}) {
  let timer = null;
  let pending = false;
  let passRunning = false;
  let lastPassEndedAtMs = 0;

  function request() {
    if (timer) return;
    if (passRunning) {
      pending = true;
      return;
    }
    const sinceLastPass = monotonicMs() - lastPassEndedAtMs;
    const delay = Math.max(debounceMs, minGapMs - sinceLastPass);
    timer = setTimeout(() => {
      timer = null;
      run();
    }, delay);
  }

  return {
    onFolderActivity(folderId, eventType) {
      if (eventType === 'FolderErrors' || isFolderInTransition(folderId)) {
        request();
      }
    },
    onResync() {
      request();
    },
    notePassStarted() {
      passRunning = true;
    },
    notePassEnded() {
      passRunning = false;
      lastPassEndedAtMs = monotonicMs();
      if (pending) {
        pending = false;
        request();
      }
    },
    stop() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = false;
    },
  };
}

module.exports = {
  createMonitorAccelerator,
};
