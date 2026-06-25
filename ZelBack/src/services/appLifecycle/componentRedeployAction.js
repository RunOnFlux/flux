/**
 * How a single compose COMPONENT must be handled during a composed-app redeploy
 * (reinstallOldApplications), as a 4-state enum, NOT a boolean/bare string. Decided by
 * specDiff.classifyComponentRedeploy from the installed vs target component spec:
 *   NEW       - present in the new spec but ABSENT from the installed app: install it
 *               fresh (no existing volume/container to keep or tear down). The classifier
 *               returns this instead of dereferencing an undefined installed component.
 *   UNCHANGED - byte-identical spec: leave the running component alone.
 *   SOFT      - spec changed but the volume (hdd) did NOT: redeploy keeping the volume.
 *   HARD      - the volume (hdd) changed: redeploy resetting the volume.
 *
 * Object.freeze'd so the set cannot drift, and every member is a string so `if (action)`
 * is never a valid check (all four members are truthy) - callers MUST compare against a
 * named member. Mirrors the InstallResult enum (see installResult.js).
 */
const ComponentRedeployAction = Object.freeze({
  NEW: 'new', // added by this update: install fresh
  UNCHANGED: 'unchanged', // identical: leave it
  SOFT: 'soft', // spec changed, volume kept
  HARD: 'hard', // hdd changed, volume reset
});

module.exports = ComponentRedeployAction;
