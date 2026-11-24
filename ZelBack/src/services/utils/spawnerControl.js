// When the spawner runs, and what stops it.
//
// The spawner runs on one FluxController while the node is ready (the app-state
// sync says so) and no move of the node's address is being worked through. Losing
// readiness, or a move, stops it: every attempt in flight is marked stopped at
// once and ends at its next wait, or at its install, and an install already
// holding the spawner's lock is waited for until the node records the app, so
// whatever the stopper does next sees it. It starts again, deciding afresh, once
// both allow it. Stops run one after another, so a start can never land inside an
// abort that is still unwinding.
//
// An install of an app from any other route stops an attempt for that app that
// has not begun its own install: the decision it was acting on no longer holds.

const { FluxController } = require('./fluxController');

/** Thrown into an attempt the spawner was stopped in. */
class SpawnerStopped extends Error {
  constructor() {
    super('the spawner was stopped');
    this.name = 'SpawnerStopped';
  }
}

const controller = new FluxController();
// The attempts not yet ended. An attempt is marked, never asked: its stop holds
// whether or not the stop that marked it has finished.
const attempts = new Set();
let runner = null;
let ready = false;
// a move of this node's address whose apps or geolocation are still to be handled
let moveDue = false;
let stops = Promise.resolve();

function wanted() {
  return Boolean(runner) && ready && !moveDue;
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
  attempts.forEach((attempt) => attempt.markStopped());
  stops = stops.then(() => controller.abort()).then(startIfWanted);
  return stops;
}

/**
 * One spawner attempt: the app it is for once chosen, its waits and its install.
 */
class Attempt {
  #app = null;

  #installing = false;

  #stopped = false;

  markStopped() {
    this.#stopped = true;
  }

  /**
   * Whether this attempt was deciding on `appName` and has not begun its install.
   * @param {string} appName
   * @returns {boolean}
   */
  decidingOn(appName) {
    return !this.#installing && Boolean(this.#app) && this.#app.toLowerCase() === appName.toLowerCase();
  }

  /**
   * @param {string} appName The app this attempt has chosen.
   */
  forApp(appName) {
    this.#app = appName;
  }

  /**
   * Waits `ms`, or rejects with SpawnerStopped once this attempt is stopped.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  async sleep(ms) {
    if (this.#stopped) throw new SpawnerStopped();
    await controller.sleep(ms).catch(() => {
      throw new SpawnerStopped();
    });
    if (this.#stopped) throw new SpawnerStopped();
  }

  /**
   * Takes the spawner's lock for this attempt's install: a stop waits for it to be
   * let go. An attempt stopped before it was taken installs nothing.
   * @returns {function(): void} Lets the lock go; a second call does nothing.
   * @throws {SpawnerStopped} When this attempt is stopped.
   */
  holdForInstall() {
    controller.lock.register();
    if (this.#stopped) {
      controller.lock.disable();
      throw new SpawnerStopped();
    }
    this.#installing = true;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      controller.lock.disable();
    };
  }

  end() {
    attempts.delete(this);
  }
}

/**
 * Begins an attempt; `end()` it once it is over.
 * @returns {Attempt}
 */
function beginAttempt() {
  const attempt = new Attempt();
  attempts.add(attempt);
  return attempt;
}

/**
 * For an install of `appName` from another route: stops the spawner when an
 * attempt is deciding on that app, which ends the attempt and has the spawner
 * decide afresh.
 * @param {string} appName
 * @returns {Promise<void>} Settles once the stop has let go; at once when no attempt
 *   is deciding on the app.
 */
function stopAttemptFor(appName) {
  if (![...attempts].some((attempt) => attempt.decidingOn(appName))) return Promise.resolve();
  return stop();
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
 * Whether a move of this node's address still has apps or a geolocation to
 * handle. While it has, the spawner is stopped: the attempt in flight ends, an
 * install holding the spawner's lock is waited for until it lets the lock go, and
 * no attempt starts, during the move's passes and between them, since a decision
 * taken then would be taken at the place the node left.
 * @param {boolean} due
 * @returns {Promise<void>} Settles once the stop it caused has let go; at once when not due.
 */
async function setMoveDue(due) {
  moveDue = due;
  if (due) {
    await stop();
    return;
  }
  startIfWanted();
}

module.exports = {
  SpawnerStopped,
  setRunner,
  setReady,
  setMoveDue,
  beginAttempt,
  stopAttemptFor,
};
