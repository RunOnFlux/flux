// Node control for systemd-mode nodes (createTestEnv({ systemdMode: true })).
//
// The default entrypoint's levers in container.js (restartFluxos,
// restartDockerd) drive a shell watchdog that does not exist here: under systemd
// FluxOS and dockerd are real units, so the equivalents are systemctl calls —
// which is also how a production host does it, making these the more faithful
// instruments of the two.
//
// The unit names mirror production: `fluxos` is the name an Arcane node's unit
// carries.
import { execInContainer } from './container.js';
import { waitFor } from './wait.js';

const FLUXOS_UNIT = 'fluxos';
const DOCKERD_UNIT = 'dockerd';

// Single-quote for `sh -c`: end the quote, escape the quote, reopen.
const shQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;


// Polling is waitFor's job, not this module's. A private copy is a second set of
// semantics for one behaviour, and the two had already diverged: waitFor knows an
// absence from a fault (NotPresentError) and this did not, so a probe written here
// tomorrow would silently inherit the older, worse contract. One helper, one meaning.
async function poll(fn, { timeout, interval, label }) {
  await waitFor(fn, { timeout, interval, label });
}

/** `systemctl is-active <unit>` — 'active' | 'inactive' | 'failed' | 'activating' | … */
export async function unitState(container, unit) {
  const r = await execInContainer(container, `systemctl is-active ${unit}`);
  return r.stdout.trim();
}

export async function waitForUnitState(container, unit, state, { timeout = 60000, interval = 1000 } = {}) {
  await poll(async () => (await unitState(container, unit)) === state,
    { timeout, interval, label: `unit ${unit} -> ${state}` });
}

/**
 * Stop a unit and wait for it to actually be inactive. Explicit stops suppress
 * the units' `Restart=always`, which a kill would not — a killed fluxos is back
 * in RestartSec=1, far too fast to do anything during the outage.
 */
export async function stopUnit(container, unit, { timeout = 60000 } = {}) {
  await execInContainer(container, `systemctl stop ${unit}`);
  await waitForUnitState(container, unit, 'inactive', { timeout });
}

/**
 * Start a unit and wait for it to be active. Clears any failed state first:
 * repeated start/stop cycles while iterating on a suite trip systemd's
 * start-limit burst, after which plain `start` refuses until reset.
 */
export async function startUnit(container, unit, { timeout = 60000 } = {}) {
  await execInContainer(container, `systemctl reset-failed ${unit} 2>/dev/null; systemctl start ${unit}`);
  await waitForUnitState(container, unit, 'active', { timeout });
}

/** Stop-then-start, so the caller cannot observe a false "never went down". */
export async function restartUnit(container, unit, opts = {}) {
  await stopUnit(container, unit, opts);
  await startUnit(container, unit, opts);
}

/**
 * Stop FluxOS and confirm its API is actually unreachable. The app containers
 * and the inner dockerd keep running — this is the FluxOS-side outage.
 */
export async function stopFluxos(container, { apiPort = 16127, timeout = 60000, interval = 500 } = {}) {
  await stopUnit(container, FLUXOS_UNIT, { timeout });
  const probe = `curl -sf -o /dev/null http://127.0.0.1:${apiPort}/flux/version`;
  await poll(async () => (await execInContainer(container, probe)).exitCode !== 0,
    { timeout, interval, label: 'fluxos API down' });
}

/** Start FluxOS and wait until its API answers again. */
export async function startFluxos(container, { apiPort = 16127, readyTimeoutMs = 120000, interval = 500 } = {}) {
  await startUnit(container, FLUXOS_UNIT, { timeout: readyTimeoutMs });
  const probe = `curl -sf -o /dev/null http://127.0.0.1:${apiPort}/flux/version`;
  await poll(async () => (await execInContainer(container, probe)).exitCode === 0,
    { timeout: readyTimeoutMs, interval, label: 'fluxos API ready' });
}

/**
 * The systemd-mode restartFluxos: FluxOS's in-memory state is wiped while
 * dockerd and the app containers keep running. Observably down, then up.
 */
export async function restartFluxos(container, opts = {}) {
  await stopFluxos(container, opts);
  await startFluxos(container, opts);
}

/** Hold dockerd down (the docker-outage fault injection) until resumeDockerd. */
export async function pauseDockerd(container, opts = {}) {
  await stopUnit(container, DOCKERD_UNIT, opts);
  await poll(async () => (await execInContainer(container, 'docker info > /dev/null 2>&1')).exitCode !== 0,
    { timeout: opts.timeout ?? 30000, interval: 200, label: 'dockerd unreachable' });
}

/** Release a pauseDockerd outage and wait until docker answers again. */
export async function resumeDockerd(container, opts = {}) {
  await startUnit(container, DOCKERD_UNIT, opts);
  await poll(async () => (await execInContainer(container, 'docker info > /dev/null 2>&1')).exitCode === 0,
    { timeout: opts.timeout ?? 60000, interval: 500, label: 'dockerd reachable' });
}

/**
 * Read a unit's journal. `processOnly` restricts to the unit's own output
 * stream (`_TRANSPORT=stdout`, which carries both stdout and stderr) — without
 * it `-u` also returns systemd's MANAGER lines about the unit ("Started
 * fluxos.service…"), which match a pattern the unit itself never wrote.
 * Leave it off unless the unit is known to log via its stdout: a
 * unit journaling natively (sd_journal_send) would be filtered to nothing,
 * which is silence, not a failure.
 */
export async function journalGrep(container, unit, pattern, { processOnly = false, lines = 5 } = {}) {
  const transport = processOnly ? ' _TRANSPORT=stdout' : '';
  const r = await execInContainer(
    container,
    `journalctl -u ${unit}${transport} -o cat --no-pager | grep -F ${shQuote(pattern)} | tail -${lines}`,
  );
  return r.stdout;
}

/** How many of a unit's journal lines contain `pattern` (substring, not regex). */
export async function journalCount(container, unit, pattern, { processOnly = false } = {}) {
  const transport = processOnly ? ' _TRANSPORT=stdout' : '';
  const r = await execInContainer(
    container,
    `journalctl -u ${unit}${transport} -o cat --no-pager | grep -cF ${shQuote(pattern)} || true`,
  );
  return Number(r.stdout.trim() || '0');
}
