// When the spawner runs, and what stops it.
//
// The spawner runs on one FluxController while the node is ready (the app-state
// sync says so) and no move of the node's address is being worked through. Losing
// readiness, or a move, stops it: the attempt in flight ends at its next wait, or
// at its install, and an install already holding the spawner's lock is waited for
// until the node records the app, so whatever the stopper does next sees it.
// It starts again, deciding afresh, once both allow it. Stops run one after
// another, so a start can never land inside an abort that is still unwinding.

const { FluxController } = require('./fluxController');

/** Thrown into an attempt the spawner was stopped in. */
class SpawnerStopped extends Error {
  constructor() {
    super('the spawner was stopped');
    this.name = 'SpawnerStopped';
  }
}

const controller = new FluxController();
let runner = null;
let ready = false;
let moves = 0;
let stops = Promise.resolve();

function wanted() {
  return Boolean(runner) && ready && moves === 0;
}

function startIfWanted() {
  if (wanted() && !controller.running) controller.startLoop(runner);
}

/**
 * Stops the spawner after any stop already under way, then starts it again if
 * it is wanted by then.
 * @returns {Promise<void>}
 */
function stop() {
  stops = stops.then(() => controller.abort()).then(startIfWanted);
  return stops;
}

/**
 * @param {function(): Promise<number>} fn One spawner pass; answers the ms until the next.
 */
function setRunner(fn) {
  runner = fn;
}

/**
 * Ready, the spawner starts, or does once a stop under way has let go; not ready,
 * it stops.
 * @param {boolean} value Whether the node is ready to take apps.
 * @returns {Promise<void>} Settles once the stop it caused has let go; at once when ready.
 */
async function setReady(value) {
  ready = value;
  if (!value) {
    await stop();
    return;
  }
  startIfWanted();
}

/**
 * Runs `work` with the spawner stopped: the attempt in flight ends, an install
 * holding the spawner's lock is waited for until it lets the lock go, and the
 * spawner starts again after
 * `work` if it is wanted then.
 * @param {function(): Promise<*>} work
 * @returns {Promise<*>} What `work` returns.
 */
async function duringMove(work) {
  moves += 1;
  try {
    await stop();
    return await work();
  } finally {
    moves -= 1;
    startIfWanted();
  }
}

/**
 * Waits `ms`, or rejects with SpawnerStopped as soon as the spawner is stopped.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return controller.sleep(ms).catch(() => {
    throw new SpawnerStopped();
  });
}

/**
 * Takes the spawner's lock for an install: a stop waits for it to be let go.
 * A stop that began before it was taken wins, and nothing is installed.
 * @returns {function(): void} Lets the lock go; a second call does nothing.
 * @throws {SpawnerStopped} When the spawner is being stopped.
 */
function holdForInstall() {
  controller.lock.register();
  if (controller.aborted) {
    controller.lock.disable();
    throw new SpawnerStopped();
  }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    controller.lock.disable();
  };
}

module.exports = {
  SpawnerStopped,
  setRunner,
  setReady,
  duringMove,
  sleep,
  holdForInstall,
};
