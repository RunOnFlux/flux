import { getAppContainerStatus } from './container.js';
import { throwIfInfraDead, sleepUnlessInfraDead } from './infra-death.js';

export async function waitFor(condition, { timeout = 60000, interval = 2000, label = '' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    // An infra container died: the condition is unreachable, not merely unmet.
    throwIfInfraDead();
    if (await condition()) return true;
    await sleepUnlessInfraDead(interval);
  }
  // ...including a death that landed during the last sleep, which would
  // otherwise be reported as this wait's own timeout.
  throwIfInfraDead();
  throw new Error(`Timeout after ${timeout}ms waiting for: ${label || 'condition'}`);
}

// Container-state wait helpers (docker-level, via the node's DinD)
export async function waitForUp(client, appName, label, { timeout = 120000, interval = 2000 } = {}) {
  await waitFor(async () => {
    const status = await getAppContainerStatus(client.container, appName);
    return !!(status && status.status.startsWith('Up'));
  }, { timeout, interval, label });
}

export async function waitForDown(client, appName, label, { timeout = 60000, interval = 2000 } = {}) {
  await waitFor(async () => {
    const status = await getAppContainerStatus(client.container, appName, { all: true });
    return !!(status && !status.status.startsWith('Up'));
  }, { timeout, interval, label });
}

// Event-based wait helpers (use SSE event stream)
// All accept an optional `opts` object passed through to waitForEvent (e.g. { afterId })

export async function waitForDaemonPolled(node, predicate = () => true, timeout = 30000, opts) {
  return node.waitForEvent('daemon:polled', predicate, timeout, opts);
}

export async function waitForDaemonReady(node, timeout = 60000, opts) {
  return node.waitForEvent('daemon:polled', () => true, timeout, opts);
}

export async function waitForBlockProcessed(node, predicate = () => true, timeout = 30000, opts) {
  return node.waitForEvent('block:processed', predicate, timeout, opts);
}

// --- network state (networkStateService) ---

// The node's OWN view of the fleet, which is a cache refreshed on a timer -
// not the daemon's list. A suite that changes the node list therefore has no
// way to know when THIS node has read the change: the endpoints that report a
// list ask the daemon, and sleeping long enough instead is what turns into a
// flaky suite.
//
// Pass { afterId } from getLastEventId() taken BEFORE the change is made. The
// buffer holds every refresh since boot, so without an anchor a wait for a
// given size can match a refresh that happened before the change and pass
// having observed nothing.
export async function waitForNetworkState(node, predicate = () => true, timeout = 60000, opts) {
  return node.waitForEvent('networkstate:updated', predicate, timeout, opts);
}

// The common case: wait until the node's own view holds this many nodes.
export async function waitForNetworkStateSize(node, nodes, timeout = 60000, opts) {
  return waitForNetworkState(node, (d) => d.nodes === nodes, timeout, opts);
}

export async function waitForDosChanged(node, predicate = () => true, timeout = 30000, opts) {
  return node.waitForEvent('dos:changed', predicate, timeout, opts);
}

export async function waitForAppInstalled(node, appName, timeout = 60000, opts) {
  return node.waitForEvent('app:installed', (data) => data.name === appName, timeout, opts);
}

export async function waitForAppRemoved(node, appName, timeout = 60000, opts) {
  return node.waitForEvent('app:removed', (data) => data.name === appName, timeout, opts);
}

export async function waitForNodeStatus(node, predicate, timeout = 30000, opts) {
  return node.waitForEvent('confirmation:changed', predicate, timeout, opts);
}

export async function waitForAppSpecStored(node, appName, timeout = 120000, opts) {
  return node.waitForEvent('app:specStored', (data) => data.name === appName, timeout, opts);
}

export async function waitForDaemonUnreachable(node, timeout = 30000, opts) {
  return node.waitForEvent('daemon:unreachable', () => true, timeout, opts);
}

export async function waitForDaemonRecovered(node, timeout = 30000, opts) {
  return node.waitForEvent('daemon:recovered', () => true, timeout, opts);
}

export async function waitForExplorerReady(node, timeout = 120000, opts) {
  return node.waitForEvent('explorer:ready', () => true, timeout, opts);
}

export async function waitForMessageCapabilityChanged(node, capable, timeout = 30000, opts) {
  return node.waitForEvent('messageCapability:changed', (d) => d.capable === capable, timeout, opts);
}

export async function waitForOrchestratorStarted(node, timeout = 120000, opts) {
  return node.waitForEvent('orchestrator:started', () => true, timeout, opts);
}

export async function waitForOrchestratorState(node, state, timeout = 60000, opts) {
  return node.waitForEvent('orchestrator:stateChanged', (d) => d.to === state, timeout, opts);
}

export async function waitForPeerThreshold(node, timeout = 120000, opts) {
  return node.waitForEvent('peers:thresholdReached', () => true, timeout, opts);
}

export async function waitForBootSettled(node, timeout = 120000, opts) {
  return node.waitForEvent('boot:settled', () => true, timeout, opts);
}

// Boot anchor for log-asserting suites: the boot:settled EVENT is the
// behavioural bound, but it is published one statement BEFORE the settle log
// line is written (appStartupManager's finally block), and the SSE push beats
// the docker log pipeline (container stdout → dockerd → attach stream →
// collector) by tens of ms. Awaiting the settle LINE as well gives a pipeline
// sync point: the log stream is FIFO, so once that line has arrived every line
// written before it has too — instant nodeHasLog asserts (including absence
// asserts) made after this anchor are race-free. Call it from a block's
// before() so every test in the block is order-independent.
export async function waitForBootSettledAndLogged(env, index = 0, { timeout = 50000 } = {}) {
  await waitForBootSettled(env.clients[index], timeout);
  await waitFor(
    () => env.nodeHasLog(index, 'Boot container state settled'),
    { timeout: 10000, interval: 250, label: 'settled log line' },
  );
}

export async function waitForPeersBelowThreshold(node, timeout = 30000, opts) {
  return node.waitForEvent('peers:belowThreshold', () => true, timeout, opts);
}

export async function waitForSpawnerPaused(node, timeout = 30000, opts) {
  return node.waitForEvent('spawner:paused', () => true, timeout, opts);
}

export async function waitForSpawnerResumed(node, timeout = 60000, opts) {
  return node.waitForEvent('spawner:resumed', () => true, timeout, opts);
}

export async function waitForSpawnerBlocked(node, reason, timeout = 30000, opts) {
  return node.waitForEvent('spawner:blocked', (d) => d.reason === reason, timeout, opts);
}

export async function waitForImageUpdateChecked(node, timeout = 60000, opts) {
  return node.waitForEvent('imageUpdate:checked', () => true, timeout, opts);
}

export async function waitForImageUpdateRedeploy(node, appName, timeout = 120000, opts) {
  return node.waitForEvent('imageUpdate:redeployTriggered', (d) => d.appName === appName, timeout, opts);
}

export async function waitForImageUpdateRedeployComplete(node, appName, timeout = 120000) {
  return node.waitForEvent('imageUpdate:redeployComplete', (d) => d.appName === appName, timeout);
}

export async function waitForSpawnerDeferred(node, appName, reason, timeout = 60000) {
  const entry = await node.waitForEvent('spawner:deferred', (d) => d.appName === appName && (!reason || d.reason === reason), timeout);
  return entry.data;
}

export async function waitForAppRunning(node, appName, timeout = 60000) {
  return node.waitForEvent('app:running', (d) => d.apps?.some((a) => a.name === appName), timeout);
}

// The payload carries outbound/inbound/total as they stand after the removal, so
// a caller can wait on the COUNT rather than on any particular peer leaving.
// Pass { afterId } from getLastEventId() before the change is triggered: the
// buffer holds every removal since boot, and without an anchor a wait for
// total === 0 can match one of those and pass without observing anything.
export async function waitForPeersRemoved(node, predicate = () => true, timeout = 30000, opts) {
  return node.waitForEvent('peers:removed', predicate, timeout, opts);
}

// --- masterSlave (g:) election ---
//
// Facts as events, cadence as a counter - see the rule at the top of
// ZelBack/src/services/utils/fluxEventBus.js. A start is a fact and arrives as
// an event; "the loop ran again and decided the same thing" is cadence and is
// counted, so waiting on it never depends on guessing the loop's interval.

export async function waitForMasterSlaveStarted(node, identifier, timeout = 60000, opts) {
  return node.waitForEvent(
    'masterSlave:started',
    (d) => d.identifier === identifier,
    timeout,
    opts,
  );
}

// Resolves once the election has been observed taking `decision` about
// `identifier` at least `count` times beyond `from` - i.e. that many further
// passes have run AND each took that branch.
//
// This is what replaces sleeping for "about N election cycles". A sleep assumes
// the loop ran; under a loaded runner it can elapse with zero passes, leaving
// any assertion after it true by default. This cannot: it is waiting on the
// passes themselves, so it is correct at any cadence and on any machine.
export async function waitForElectionDecisions(
  node,
  identifier,
  decision,
  count,
  { from = 0, timeout = 60000, interval = 1000 } = {},
) {
  await waitFor(
    async () => await node.getDecisionCount('masterSlave:decision', identifier, decision) >= from + count,
    { timeout, interval, label: `${count} further '${decision}' election decisions for ${identifier}` },
  );
}

export async function electionDecisionCount(node, identifier, decision) {
  return node.getDecisionCount('masterSlave:decision', identifier, decision);
}

// --- reconciler (appReconciler) ---

// action: 'started' | 'stopped' | 'backoff' | 'recreated' | 'recreateFailed' (omit to match any)
export async function waitForReconcileActuated(node, identifier, action, timeout = 60000, opts) {
  return node.waitForEvent(
    'reconciler:actuated',
    (d) => d.identifier === identifier && (!action || d.action === action),
    timeout,
    opts,
  );
}

// state: 'running' | 'stopped' (omit to match any)
export async function waitForReconcilerDesiredChanged(node, identifier, state, timeout = 60000, opts) {
  return node.waitForEvent(
    'reconciler:desiredChanged',
    (d) => d.identifier === identifier && (!state || d.state === state),
    timeout,
    opts,
  );
}

// reason: 'reconnect' | 'hourly' | 'boot' | 'resync' (omit to match any)
export async function waitForReconcileSwept(node, reason, timeout = 60000, opts) {
  return node.waitForEvent(
    'reconciler:swept',
    (d) => !reason || d.reason === reason,
    timeout,
    opts,
  );
}

// A file operation answers 202 and reports its outcome through a status
// resource. A poll is ALWAYS 200 whatever the job did - a failed operation is
// still a successful poll - so the terminal condition is read from the body's
// status field and never from the HTTP code.
const TERMINAL_JOB_STATUSES = ['Succeeded', 'Failed', 'Canceled', 'Evicted'];

/**
 * Poll an operation until it settles, and hand back the whole job.
 *
 * Deliberately returns a failed job rather than throwing on one: a suite
 * asserting that a hostile archive is refused wants the Failed job and its
 * error, and an operation that never settles at all is this helper's only
 * failure. Every poll goes through waitFor, so a dead infra container ends the
 * wait as infra death rather than as this operation's timeout.
 *
 * @returns {Promise<object>} The terminal job document.
 */
export async function waitForOperation(node, jobId, zelidauth, { timeout = 180000, interval = 1000 } = {}) {
  let job = null;
  await waitFor(async () => {
    const res = await node.request('GET', `/apps/operations/${jobId}`, { headers: { zelidauth } });
    if (res.status !== 200) {
      throw new Error(`poll of ${jobId} answered ${res.status}, expected 200: ${JSON.stringify(res.data)}`);
    }
    job = res.data?.data;
    return TERMINAL_JOB_STATUSES.includes(job?.status);
  }, { timeout, interval, label: `operation ${jobId} to reach a terminal status` });
  return job;
}

/**
 * Negative assertion: wait `windowMs` and assert that NO event named `name`
 * matching `predicate` arrived in that window. Captures the current last-seen
 * event id up front so events already buffered before the call are ignored.
 * Use for "the reconciler must NOT start this container" (e.g. syncthing S10).
 */
export async function assertNoEvent(node, name, predicate = () => true, windowMs = 5000) {
  const afterId = node.getLastEventId();
  await sleepUnlessInfraDead(windowMs);
  // A dead infra container makes "no event arrived" trivially true, so this
  // assertion would PASS on a void run. Fail it instead.
  throwIfInfraDead();
  const match = node.getEventBuffer().find(
    (e) => e.event === name && e.id > afterId && predicate(e.data),
  );
  if (match) {
    throw new Error(`Expected no '${name}' event within ${windowMs}ms but got: ${JSON.stringify(match.data)}`);
  }
}
