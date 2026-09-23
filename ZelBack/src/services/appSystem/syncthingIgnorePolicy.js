const log = require('../../lib/log');
const syncthingService = require('../syncthingService');
const { syncthingIgnoreLines } = require('./volumeReservedNames');

/** Whether two ignore sets are the same policy. Order is part of it: syncthing takes the
 * FIRST pattern that matches, so the same lines in another order are not the same rule. */
const sameLines = (left, right) => left.length === right.length
  && left.every((line, index) => line === right[index]);


/**
 * Ensure a folder's syncthing ignores carry every FluxOS policy line.
 *
 * .stignore is syncthing's own control file - it writes it atomically, runs as
 * root so it lands on any legacy root-owned file, and never replicates it or
 * its temp. So FluxOS sets the patterns through syncthing's API rather than
 * writing the file: there is no temp, no ownership dance, and nothing on the
 * volume to orphan on a powercut. Volume creation still seeds the file directly
 * for a brand-new folder syncthing does not yet know; this converges every
 * EXISTING folder whose ignores predate a policy line.
 *
 * THE SPEC IS THE WHOLE FILE. What may leave this node is decided by the
 * specification and by nothing found on the volume, so the ignores are set to the
 * derived lines exactly rather than merged into whatever is already there.
 *
 * Every node must compute the same set from the same spec, and a file on one
 * node's disk is not an input the others have - merged in, the answer depends on
 * which node is asked. syncthing also takes the FIRST pattern that matches, so a
 * line ahead of a derived one answers in its place; the derived set leads because
 * it is the whole list, not because it was sorted there.
 *
 * It also makes the set exact in the other direction. A spec that drops an ml:
 * mount has its exclusion removed with it, because the desired set is derived
 * afresh every pass and never accumulates - where a merge could not tell a line
 * it wrote last week from anything else in the file, and had to leave a directory
 * unreplicated that the spec now asks to replicate.
 *
 * The current set is read only to decide whether a write is needed: nothing is
 * posted when the folder already reads that way, so a converged folder is neither
 * rewritten nor rescanned, which is what makes this safe on every monitor pass.
 *
 * That rests on a line coming back as it was sent. Syncthing trims each line as it
 * reads the file and reports it, and does nothing else to it - the dedup, the
 * comment skipping, the escape handling and the unicode normalisation all build
 * the PATTERNS and never touch what is reported. Every line derived here is
 * therefore returned verbatim: the policy lines carry no whitespace, and a name
 * that would is refused where the specification is read (isLiteralIgnoreName). A
 * line that stopped round-tripping would show as this folder being set on every
 * pass, in the log below.
 *
 * Every syncthing call returns its outcome in-band and never throws, so status is
 * checked rather than caught.
 *
 * Call only for a folder syncthing already knows (the caller checks); on an
 * unknown folder the API would answer with an error and nothing would converge.
 *
 * WHAT AN UPGRADED VOLUME IS EXPOSED TO BEFORE THE FIRST PASS, AND WHY IT IS ONE PASS
 * RATHER THAN ONE INTERVAL. A volume built by an earlier release carries that release's
 * lines, so a name this one adds is unignored until the converge below runs - and the
 * file API, which is what can put something under such a name, opens on
 * bootContainerStateSettled. So does the monitor that calls this: serviceManager starts
 * them from the same gate. The exposure is therefore however long the first pass takes
 * to reach this folder, not the interval between passes, and it does not recur.
 *
 * @param {string} folderId - the syncthing folder id (the app identifier)
 * @param {string[]} unsyncedSubdirs - volume-root names the component declared with ml:
 */
async function ensureStignoreCovers(folderId, unsyncedSubdirs = []) {
  const read = await syncthingService.getFolderIgnores(folderId);
  if (read.status !== 'success') {
    log.error(`ensureStignoreCovers - could not read ignores for ${folderId}: ${read.data?.message ?? 'unknown error'}`);
    return;
  }
  const desired = syncthingIgnoreLines(unsyncedSubdirs);
  const current = Array.isArray(read.data?.ignore) ? read.data.ignore : [];
  if (sameLines(desired, current)) return;

  const written = await syncthingService.setFolderIgnores(folderId, desired);
  if (written.status !== 'success') {
    log.error(`ensureStignoreCovers - could not set ignores for ${folderId}: ${written.data?.message ?? 'unknown error'}`);
    return;
  }
  log.info(`ensureStignoreCovers - ${folderId} ignores set to ${desired.join(', ')}`);
}

module.exports = {
  ensureStignoreCovers,
};
