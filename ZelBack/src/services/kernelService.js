/**
 * The conditions the kernel has recorded against itself since boot, from its
 * taint flags. A flag is set when its condition first occurs and clears only on
 * a reboot, so a kernel that has oopsed (D) reads so until the node restarts.
 *
 * Reported, never acted on. Read from procfs on every call; the kernel
 * generates the value on read.
 */

const fs = require('node:fs/promises');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const { Privilege, authOf } = require('./utils/privileges');

const TAINTED_PATH = '/proc/sys/kernel/tainted';

/**
 * Every taint bit the kernel defines, with the letter it prints for it
 * (Documentation/admin-guide/tainted-kernels.rst). Bit 0 prints P when set and
 * G when clear; only set bits are reported, so it is P here.
 */
const TAINT_FLAGS = Object.freeze([
  { bit: 0, letter: 'P', description: 'Proprietary module was loaded' },
  { bit: 1, letter: 'F', description: 'Module was force loaded' },
  { bit: 2, letter: 'S', description: 'Kernel running on an out of specification system' },
  { bit: 3, letter: 'R', description: 'Module was force unloaded' },
  { bit: 4, letter: 'M', description: 'Processor reported a Machine Check Exception (MCE)' },
  { bit: 5, letter: 'B', description: 'Bad page referenced or some unexpected page flags' },
  { bit: 6, letter: 'U', description: 'Taint requested by userspace application' },
  { bit: 7, letter: 'D', description: 'Kernel died recently, i.e. there was an OOPS or BUG' },
  { bit: 8, letter: 'A', description: 'An ACPI table was overridden by user' },
  { bit: 9, letter: 'W', description: 'Kernel issued warning' },
  { bit: 10, letter: 'C', description: 'Staging driver was loaded' },
  { bit: 11, letter: 'I', description: 'Workaround for bug in platform firmware applied' },
  { bit: 12, letter: 'O', description: 'Externally-built ("out-of-tree") module was loaded' },
  { bit: 13, letter: 'E', description: 'Unsigned module was loaded' },
  { bit: 14, letter: 'L', description: 'Soft lockup occurred' },
  { bit: 15, letter: 'K', description: 'Kernel has been live patched' },
  { bit: 16, letter: 'X', description: 'Auxiliary taint, defined for and used by distros' },
  { bit: 17, letter: 'T', description: 'Kernel was built with the struct randomization plugin' },
  { bit: 18, letter: 'N', description: 'An in-kernel test has been run' },
  { bit: 19, letter: 'J', description: 'Userspace used a mutating debug operation in fwctl' },
]);

/**
 * The flags set in a taint value, lowest bit first. A set bit the table does not
 * define is reported with a null letter and description rather than dropped, so
 * a kernel newer than the table still shows that it is tainted.
 * @param {number} value The taint value.
 * @returns {{bit: number, letter: (string|null), description: (string|null)}[]}
 */
function decodeTaint(value) {
  const flags = [];
  const bits = BigInt(value);
  // eslint-disable-next-line no-bitwise
  for (let bit = 0; (bits >> BigInt(bit)) > 0n; bit += 1) {
    // eslint-disable-next-line no-bitwise
    if ((bits >> BigInt(bit)) & 1n) {
      const known = TAINT_FLAGS.find((flag) => flag.bit === bit);
      flags.push(known ?? { bit, letter: null, description: null });
    }
  }
  return flags;
}

/**
 * Reads the kernel's taint value now. Null when it cannot be read or does not
 * parse: that is unknown, never untainted.
 * @returns {Promise<{tainted: (number|null), flags: (object[]|null), readAt: string}>}
 */
async function readTaint() {
  const readAt = new Date().toISOString();
  let raw;
  try {
    raw = await fs.readFile(TAINTED_PATH, 'utf8');
  } catch {
    return { tainted: null, flags: null, readAt };
  }
  const text = raw.trim();
  const value = /^\d+$/.test(text) ? Number(text) : null;
  if (!Number.isSafeInteger(value)) return { tainted: null, flags: null, readAt };
  return { tainted: value, flags: decodeTaint(value), readAt };
}

/**
 * @returns {Promise<{tainted: (number|null), flags: (string[]|null)}>} What
 *   /flux/info carries: the value and the letters of its flags. A bit the table
 *   does not define appears as '?'.
 */
async function getTaintSummary() {
  const { tainted, flags } = await readTaint();
  return { tainted, flags: flags && flags.map((flag) => flag.letter ?? '?') };
}

/**
 * GET /flux/kernel - the taint value with each flag's bit, letter and
 * description, for the node operator and the Flux team.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>}
 */
async function kernelAPI(req, res) {
  const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
  if (authorized !== true) return res.json(messageHelper.errUnauthorizedMessage());
  return res.json(messageHelper.createDataMessage(await readTaint()));
}

module.exports = {
  TAINTED_PATH,
  TAINT_FLAGS,
  decodeTaint,
  readTaint,
  getTaintSummary,
  kernelAPI,
};
