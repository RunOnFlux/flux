/**
 * Every port a seeded app holds, handed out from one place.
 *
 * A port is a property of the FLEET, not of whoever wrote the test, and the
 * only invariant that matters is that no two apps in a suite want the same one:
 * satisfy that and no node can end up holding two apps on one port, however the
 * suite places them. Each suite is its own process, so this is per suite.
 *
 * Called from buildSeedableApp, which is where a specification is BUILT - and
 * it has to be there rather than at seed time, because the spec is signed and
 * hashed the moment it is built. A port added afterwards leaves the app
 * carrying a hash of a specification that no longer exists.
 *
 * That is also the seam with no holes. The rule was first written into the nine
 * builders, which four suites route around by hand-writing their compose; then
 * into reconciler-suite.seedGlobalSpec, which five route around by seeding to
 * the database themselves. Every one of them calls buildSeedableApp.
 */
/**
 * The allocator owns everything from here up. A hand-written port must sit
 * BELOW it, and assignPorts refuses one that does not.
 *
 * Two suites cannot collide with each other - each runs in its own process
 * against its own fleet - so the only thing this has to keep apart is the
 * allocator and the literals inside one suite. Suite 60 is why it is enforced
 * rather than documented: it hand-picked 31201, the first port the allocator
 * hands out, and died in setup on a collision with an app it had just seeded.
 */
const ALLOCATION_BASE = 31200;

const claimedPorts = new Map();
let nextFreePort = ALLOCATION_BASE;

/**
 * One port, recorded against the app that now holds it.
 *
 * Exported for the legacy builder, whose specs carry ports as STRINGS - it
 * needs the number before it can spell it the way a v3 spec does.
 */
export function allocatePortFor(name) {
  do { nextFreePort += 1; } while (claimedPorts.has(nextFreePort));
  claimedPorts.set(nextFreePort, name);
  return nextFreePort;
}

/**
 * Gives every component a port of its own, and refuses an accidental collision
 * at the moment it is created.
 *
 * Two apps on one port surface minutes later as "already used with different
 * application" - an install refusal that reads like a product fault and has
 * cost three gates. Named here instead, with both apps in the message, at the
 * point where it can still be fixed by looking at the suite.
 *
 * A suite that means it passes allowPortReuse: suite 98 puts two apps on one
 * port deliberately, because that is the collision it exists to test.
 *
 * Idempotent: a second pass over the same components sees ports this same app
 * already claimed and keeps them.
 */
export function assignPorts(components, appName, { allowPortReuse = false } = {}) {
  for (const component of components) {
    // Nulls filtered, not trusted: a builder that emits [null] has declared
    // nothing, and Number(null) is 0 - a port that would look real here and
    // fail somewhere far away.
    const declared = (component.ports ?? (component.port == null ? [] : [component.port]))
      .filter((port) => port != null && port !== '' && Number.isFinite(Number(port)));

    if (!declared.length) {
      component.ports = [allocatePortFor(appName)];
      continue;
    }

    // Checked before allowPortReuse, because that opt-out is about two apps
    // sharing a port on purpose - it says nothing about reaching into the
    // allocator's range, which is never right.
    for (const port of declared.map(Number)) {
      if (port >= ALLOCATION_BASE) {
        throw new Error(
          `'${appName}' asks for port ${port}, which is inside the range the harness hands out `
          + `(${ALLOCATION_BASE} and up). Leave the port off and one will be allocated, or name a port below `
          + `${ALLOCATION_BASE} if the suite needs a specific one.`,
        );
      }
    }

    if (allowPortReuse) continue;

    for (const port of declared.map(Number)) {
      const owner = claimedPorts.get(port);
      if (owner && owner !== appName) {
        throw new Error(
          `Two apps in this suite want port ${port}: '${owner}' already has it and '${appName}' asks for it too. `
          + 'Give one of them a different port, or pass allowPortReuse if the collision is the point.',
        );
      }
      claimedPorts.set(port, appName);
    }
  }
}
