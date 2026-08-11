import { readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---- host-wide boot semaphore ----
// Fleet boot is the heaviest phase a suite has: every node in the fleet starts its
// own dockerd and runs FluxOS DB prep at once. Overlapping boots contend, and a
// healthy node can blow its event-wait budget while merely slow (observed in the
// 42-suite gate: suite 22's second fleet booted at load ~15 on 16 cores and mongo
// collection prep crawled at 7-17s a step). Running fleets are cheap, so bound the
// boot phase host-wide and let everything else overlap.
//
// BOOT_LOCK_WIDTH is how many fleets may boot at once. Two ten-node fleets booting
// together each take ~37s where one alone takes ~25s, so the pair completes in the
// time 1.5 boots would cost serially: they do contend, but the overlap wins. The
// gate is ~89% boot-lock-held wall clock, so that ratio is most of its duration.
//
// The queue is ORDERED BY ARRIVAL, and that is the whole point. A protocol that
// has every waiter race the same atomic create when the lock frees serves whoever
// wakes first, not whoever waited longest, so a suite can lose that race without
// bound while its siblings cycle through boots around it: observed in the
// 2026-08-06 gate, where suite 13 sat 30 minutes through repeated fleet boots by
// other suites and was killed by the runner's wall-clock backstop with 18 of its
// 19 tests already passed. Arrival order makes starvation structural rather than
// statistical - the queue drains in the order it formed.
//
// Each waiter owns one ticket file named `<arrivalMs>-<pid>`. The holder is the
// lowest live ticket. The pid is IN THE NAME so a ticket is created by a single
// atomic operation and can never be read half-written; a ticket whose process is
// gone is removed by whichever waiter notices, which is what reclaims the queue
// after a suite is killed mid-boot.
export const BOOT_LOCK_DIR = process.env.E2E_BOOT_LOCK_DIR ?? join(tmpdir(), 'e2e-boot-lock');
const BOOT_LOCK_POLL_MS = Number(process.env.E2E_BOOT_LOCK_POLL_MS ?? 250);
// How many fleets may boot at once. Held below MAXN so a gate still spends most of
// itself running suites rather than booting them; 1 restores strict serialisation.
export const BOOT_LOCK_WIDTH = Math.max(1, Number(process.env.E2E_BOOT_LOCK_WIDTH ?? 2));
// Generous against a FIFO queue: the worst honest wait is the suites ahead of you
// divided by the width, times one boot - ~5 boots at MAXN=6 and width 1, fewer as
// the width rises. Reaching this means the queue is wedged, not busy, and it stays
// well inside run-all.sh's 1800s per-suite backstop so the failure is reported by
// the lock rather than by a SIGKILL that explains nothing.
export const BOOT_LOCK_MAX_WAIT_MS = Number(process.env.E2E_BOOT_LOCK_MAX_WAIT_MS ?? 600000);

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Arrival stamps are wall-clock because they are compared ACROSS processes, and a
// monotonic clock has a per-process origin so its values are not comparable
// between them. Elapsed time is measured monotonically below, which is what a
// deadline actually needs.
const ticketOrder = (name) => {
  const [ms, pid] = name.split('-');
  return [Number(ms), Number(pid)];
};

// The live queue in service order. Tickets whose process is gone are removed on
// sight, which is what lets the queue drain past a suite killed mid-boot.
export function bootQueue() {
  let names;
  try {
    names = readdirSync(BOOT_LOCK_DIR);
  } catch {
    return [];
  }
  const live = [];
  for (const name of names.filter((n) => /^\d+-\d+$/.test(n))) {
    const [, pid] = ticketOrder(name);
    if (pid === process.pid) { live.push(name); continue; }
    try {
      process.kill(pid, 0);
      live.push(name);
    } catch {
      try { rmSync(join(BOOT_LOCK_DIR, name), { force: true }); } catch { /* raced */ }
    }
  }
  return live.sort((a, b) => {
    const [ams, apid] = ticketOrder(a);
    const [bms, bpid] = ticketOrder(b);
    return ams - bms || apid - bpid;
  });
}

let heldTicket = null;
let heldSince = null;
let heldFleet = '';

// Queued-vs-held is the number the lock's WIDTH turns on, and nothing recorded it:
// a suite's wall time is boot plus however long it sat behind five siblings, and the
// two are indistinguishable from the outside. Emitted as TAP comments because
// run-all.sh pipes mocha's `2>&1` straight into the .tap it later tallies with
// `grep -c '^ok '` - a leading `#` is a comment to any TAP reader and can never be
// counted as a result.
const report = (fields) => { console.log(`# boot-lock ${fields}`); };

// The fleet's shape is what explains held_ms, and a duration without it is two
// populations stirred together: nodes boot in parallel, so fleet size moves the cost
// by a few times rather than in proportion, and `syncthing: 'binary'` gives every node
// its own daemon instead of one shared stub. Both axes are needed to tell whether the
// width can vary BY fleet - two small boots overlapping is a different question from
// two ten-node ones. Carried on both lines so each is self-describing: a process takes
// the lock once per fleet it builds, so a pid does not pair an acquire with its release.
const fleetShape = ({
  nodes = 0, deferred = 0, legacy = 0, syncthing = 'stub',
} = {}) => `nodes=${nodes} deferred=${deferred} legacy=${legacy} syncthing=${syncthing}`;

export async function acquireBootLock(fleet) {
  mkdirSync(BOOT_LOCK_DIR, { recursive: true });
  const ticket = `${Date.now()}-${process.pid}`;
  writeFileSync(join(BOOT_LOCK_DIR, ticket), '');
  heldTicket = ticket;
  heldFleet = fleetShape(fleet);
  const startedAt = process.hrtime.bigint();
  let aheadOnArrival = null;
  for (;;) {
    const queue = bootQueue();
    if (aheadOnArrival === null) aheadOnArrival = Math.max(0, queue.indexOf(ticket));
    const waitedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
    // Arrival order still decides service; the width only changes how many of the
    // front of the queue are being served at once. A ticket that is NOT in the
    // queue indexes to -1, which is inside any width - so the position has to be
    // real before it can be compared. bootQueue() returns [] whenever the
    // directory cannot be read, and run-parallel.sh removes that directory, so
    // without this every waiter would read "I hold the lock" at the same moment
    // and the semaphore would be silently defeated - exactly the contention it
    // exists to prevent. Holding instead means the wait ends at the explicit
    // wedged error, which is the honest signal.
    const position = queue.indexOf(ticket);
    if (position >= 0 && position < BOOT_LOCK_WIDTH) {
      heldSince = process.hrtime.bigint();
      report(`acquired waited_ms=${waitedMs} ahead_on_arrival=${aheadOnArrival} width=${BOOT_LOCK_WIDTH} ${heldFleet} pid=${process.pid}`);
      return;
    }
    if (waitedMs > BOOT_LOCK_MAX_WAIT_MS) {
      const ahead = queue.indexOf(ticket);
      const holders = queue.slice(0, BOOT_LOCK_WIDTH).map((t) => ticketOrder(t)[1]);
      releaseBootLock();
      throw new Error(
        `boot lock: waited ${Math.round(waitedMs / 1000)}s for ${BOOT_LOCK_DIR}, `
        + `still ${ahead < 0 ? 'unknown' : ahead} ahead in the queue `
        + `(width ${BOOT_LOCK_WIDTH}, holder pids ${holders.length ? holders.join(',') : 'none'}). `
        + 'The queue is wedged, not merely busy.',
      );
    }
    await sleep(BOOT_LOCK_POLL_MS);
  }
}

export function releaseBootLock() {
  if (!heldTicket) return;
  // Null when the wait timed out rather than succeeded, which is a queue that never
  // held the lock and must not report a boot duration.
  if (heldSince !== null) {
    report(`released held_ms=${Number((process.hrtime.bigint() - heldSince) / 1000000n)} ${heldFleet} pid=${process.pid}`);
    heldSince = null;
  }
  try {
    rmSync(join(BOOT_LOCK_DIR, heldTicket), { force: true });
  } catch {
    // already released or reclaimed
  }
  heldTicket = null;
}
