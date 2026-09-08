// The infra containers - mongo, the daemon/syncthing/external/fdm stubs, the
// registry - are supposed to outlive every suite that boots them. When one dies
// mid-run nothing notices at the time: the waits already in flight simply stop
// being satisfiable and expire 30-60s later as "Timeout after 60000ms waiting for
// event: app:installed" or EHOSTUNREACH against an address that no longer
// answers. That is indistinguishable from a product bug, and it is how the
// 2026-07-30 parallel gate lost three suites to a mongo:8 SIGSEGV.
//
// This module is the single kill-switch the wait machinery consults. The death
// watcher in test-env.js trips it; waitForEvent (node-client.js), waitFor and
// assertNoEvent (wait.js), and the two poll wait strategies fail out of it
// immediately with a message that names the container, its exit code and the
// time. That message leads with the literal string INFRA-DEAD so gate tooling can
// grep a .tap for a void run without parsing anything.
//
// It is a module of its own rather than part of test-env.js so the wait machinery
// can import it without an import cycle (test-env.js already imports node-client.js).

const handlers = new Set();
let death = null;

export function infraDeathError() {
  return death;
}

export function throwIfInfraDead() {
  if (death) throw death;
}

// Called once per unexpected infra death. The FIRST death is the one worth
// reporting: a mongo that dies takes the whole fleet's database with it and
// anything that dies afterwards is a consequence of that, so later deaths are
// logged but never replace the recorded cause.
export function reportInfraDeath({ name, exitCode, at }) {
  const message = `INFRA-DEAD: ${name} exited code=${exitCode} at ${at}; run is void`;
  console.error(message);
  if (death) return;
  death = new Error(message);
  death.infraDead = true;
  // Fire once: a waiter that arrives later reads infraDeathError() instead.
  const parked = [...handlers];
  handlers.clear();
  for (const handler of parked) handler(death);
}

// Arm a fresh environment. A previous env's death must not fail the next env's
// waits - createTestEnv calls this before it starts watching.
export function clearInfraDeath() {
  death = null;
  handlers.clear();
}

// The one way the framework sleeps inside a poll loop. Rejects immediately if a
// death is already recorded, and rejects AT a death that lands mid-sleep - so
// consulting the kill switch is a property of the primitive rather than a
// convention each loop re-implements (the convention already failed once: a
// hand-rolled stability window slept through a death and passed its suite over
// a dead env). What this cannot do is stop a conclusion being drawn from an
// observation made while the env died - nodes answer from memory - so a loop
// still calls throwIfInfraDead() between observing and concluding.
export function sleepUnlessInfraDead(ms) {
  if (death) return Promise.reject(death);
  return new Promise((resolve, reject) => {
    const onDeath = (error) => { clearTimeout(timer); reject(error); };
    const timer = setTimeout(() => { offInfraDeath(onDeath); resolve(); }, ms);
    onInfraDeath(onDeath);
  });
}

// Waits parked on a listener or a timer register here so they can be rejected AT
// the death rather than at their own deadline. Callers must check
// infraDeathError() first: the switch fires once, so a handler registered after
// it tripped is never called.
export function onInfraDeath(handler) {
  handlers.add(handler);
}

export function offInfraDeath(handler) {
  handlers.delete(handler);
}
