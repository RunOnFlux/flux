/**
 * Swap for apps, from chunk files under /dat/app-swap, sized to what the
 * installed apps may swap: `config.fluxapps.defaultSwap` per component, the disk
 * admission already reserves for each one. Every container may swap that much
 * (dockerService) and no more, so with the pool covering it the system always
 * keeps the host swapfile's worth of swap. The kernel shares every swap device
 * with every process: the pool adds capacity, it does not set devices aside.
 *
 * Arcane nodes only, with /dat on XFS, and never inside a container: swap
 * belongs to the kernel, and a node in a container shares its host's.
 *
 * Reconciled from the installed apps before a container is created, after an
 * app is removed and at boot before any app starts. Kernel swap state does not
 * survive a reboot, so each reconcile also swaps on every chunk not active.
 *
 * Best effort: a pool that cannot be reconciled is logged, and the apps' swap
 * comes from the host swapfile.
 */

const path = require('path');
const fs = require('fs').promises;
const config = require('config');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const resourceQueryService = require('../appQuery/resourceQueryService');

const POOL_DIR = '/dat/app-swap';
const GIB = 1024 * 1024 * 1024;
const CHUNK_NAME = /^chunk-\d+\.swap$/;

// Chunks match the per-component reservation until there are SMALL_CHUNKS of
// them, then LARGE_CHUNK_GB each. MAX_CHUNKS stays under the kernel's 32 swap
// devices with room for the host swapfile: 12 x 2 + 8 x 8 = 88 GiB, 44 components.
const SMALL_CHUNKS = 12;
const LARGE_CHUNK_GB = 8;
const MAX_CHUNKS = 20;

let supported = null;
let reconcileChain = Promise.resolve();

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<boolean>} Whether this node keeps a swap pool. Answered
 *   once per process: none of what it reads changes while FluxOS runs.
 */
async function poolSupported() {
  if (supported !== null) return supported;

  if (!process.env.FLUXOS_PATH) {
    supported = false;
    return supported;
  }

  if (await pathExists('/.dockerenv') || await pathExists('/run/.containerenv')) {
    supported = false;
    return supported;
  }

  const res = await serviceHelper.runCommand('findmnt', {
    params: ['-n', '-o', 'FSTYPE', '--mountpoint', '/dat'],
    logError: false,
  });
  supported = !res.error && res.stdout.trim() === 'xfs';
  if (!supported) log.info('appSwapPool - /dat is not an XFS mount, no swap pool on this node');
  return supported;
}

async function rootCmd(cmd, params) {
  const res = await serviceHelper.runCommand(cmd, { runAsRoot: true, params, logError: false });
  if (res.error) throw new Error(`${cmd} ${params.join(' ')} failed: ${res.error.message || res.error}`);
  return res;
}

async function listChunks() {
  let entries;
  try {
    entries = await fs.readdir(POOL_DIR);
  } catch {
    return [];
  }
  const chunks = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const name of entries.filter((n) => CHUNK_NAME.test(n))) {
    const fullPath = path.join(POOL_DIR, name);
    // eslint-disable-next-line no-await-in-loop
    const stat = await fs.stat(fullPath);
    chunks.push({ name, fullPath, sizeGb: Math.round(stat.size / GIB) });
  }
  return chunks.sort((a, b) => a.name.localeCompare(b.name));
}

async function activeSwapPaths() {
  const res = await serviceHelper.runCommand('swapon', {
    params: ['--show=NAME', '--noheadings'],
    logError: false,
  });
  if (res.error || !res.stdout) return new Set();
  return new Set(res.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
}

function nextChunkName(chunks) {
  const indices = chunks.map((c) => Number.parseInt(c.name.slice('chunk-'.length), 10));
  const next = (indices.length ? Math.max(...indices) : -1) + 1;
  return `chunk-${String(next).padStart(4, '0')}.swap`;
}

/**
 * @param {number} count Chunks the pool already holds.
 * @returns {number} Size in GiB of the next chunk.
 */
function nextChunkGb(count) {
  return count < SMALL_CHUNKS ? config.fluxapps.defaultSwap : LARGE_CHUNK_GB;
}

/**
 * A chunk is only left on disk once it is a formatted swap file: a failed step
 * removes it, so a chunk that is listed always counts as capacity.
 */
async function addChunk(name, sizeGb) {
  const fullPath = path.join(POOL_DIR, name);
  try {
    await rootCmd('fallocate', ['-l', `${sizeGb}G`, fullPath]);
    await rootCmd('chmod', ['600', fullPath]);
    await rootCmd('mkswap', [fullPath]);
  } catch (error) {
    await serviceHelper.runCommand('rm', { runAsRoot: true, params: ['-f', fullPath], logError: false });
    throw error;
  }
  return { name, fullPath, sizeGb };
}

async function swapOnChunk(fullPath) {
  const res = await serviceHelper.runCommand('swapon', { runAsRoot: true, params: [fullPath], logError: false });
  if (res.error) log.warn(`appSwapPool - could not swapon ${fullPath}: ${res.error.message || res.error}`);
}

/**
 * swapoff moves the chunk's pages into memory or other swap, and the kernel
 * refuses when there is no room for them. The chunk then stays for a later
 * reconcile.
 * @returns {Promise<boolean>} Whether the chunk was removed.
 */
async function removeChunk(chunk, active) {
  if (active.has(chunk.fullPath)) {
    const res = await serviceHelper.runCommand('swapoff', { runAsRoot: true, params: [chunk.fullPath], logError: false });
    if (res.error) {
      log.warn(`appSwapPool - swapoff deferred for ${chunk.fullPath}: ${res.error.message || res.error}`);
      return false;
    }
  }
  await rootCmd('rm', ['-f', chunk.fullPath]);
  return true;
}

/**
 * @returns {Promise<{needGb: number, complete: boolean}>} The swap the installed
 *   apps may use. `complete` is false when an installed app could not be read,
 *   so the need may be larger than counted.
 */
async function computeNeed() {
  const response = await resourceQueryService.appsResources();
  if (response.status !== 'success') throw new Error('installed apps could not be counted');
  const { componentsLocked, unreadable } = response.data;
  return {
    needGb: componentsLocked * config.fluxapps.defaultSwap,
    complete: unreadable.length === 0,
  };
}

async function doReconcile() {
  if (!(await poolSupported())) return;

  await rootCmd('mkdir', ['-p', POOL_DIR]);
  await rootCmd('chmod', ['700', POOL_DIR]);

  const { needGb, complete } = await computeNeed();

  const chunks = await listChunks();
  const listed = chunks.length;
  let capacityGb = chunks.reduce((sum, c) => sum + c.sizeGb, 0);

  while (capacityGb < needGb && chunks.length < MAX_CHUNKS) {
    // eslint-disable-next-line no-await-in-loop
    const chunk = await addChunk(nextChunkName(chunks), nextChunkGb(chunks.length));
    chunks.push(chunk);
    capacityGb += chunk.sizeGb;
    log.info(`appSwapPool - added ${chunk.name} (${chunk.sizeGb}G), capacity ${capacityGb}G for ${needGb}G`);
  }
  if (capacityGb < needGb) {
    log.error(`appSwapPool - ${needGb}G of app swap exceeds the ${MAX_CHUNKS}-chunk pool (${capacityGb}G); the rest comes from the host swapfile`);
  }

  const active = await activeSwapPaths();
  // eslint-disable-next-line no-restricted-syntax
  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    if (!active.has(chunk.fullPath)) await swapOnChunk(chunk.fullPath);
  }

  // A need that could not be fully counted may be larger than it looks, so the
  // pool is never shrunk on one. Nor in a pass that grew it: a large chunk added
  // on top of small ones would otherwise free small ones straight away.
  if (!complete || chunks.length > listed) return;

  const activeAfter = await activeSwapPaths();
  const smallestFirst = [...chunks].sort((a, b) => a.sizeGb - b.sizeGb || b.name.localeCompare(a.name));
  // eslint-disable-next-line no-restricted-syntax
  for (const chunk of smallestFirst) {
    if (capacityGb - chunk.sizeGb < needGb) break;
    // eslint-disable-next-line no-await-in-loop
    if (await removeChunk(chunk, activeAfter)) {
      capacityGb -= chunk.sizeGb;
      log.info(`appSwapPool - removed ${chunk.name} (${chunk.sizeGb}G), capacity ${capacityGb}G for ${needGb}G`);
    }
  }
}

/**
 * Bring the pool to the installed apps' need: add or remove chunks and swap on
 * every chunk. Calls run one after another. Never rejects.
 * @returns {Promise<void>}
 */
function reconcile() {
  const run = reconcileChain.then(doReconcile).catch((error) => {
    log.error(`appSwapPool - reconcile failed: ${error.message}`);
  });
  reconcileChain = run;
  return run;
}

/**
 * Forget the cached answer of poolSupported.
 */
function resetSupportCache() {
  supported = null;
}

module.exports = {
  POOL_DIR,
  SMALL_CHUNKS,
  LARGE_CHUNK_GB,
  MAX_CHUNKS,
  computeNeed,
  doReconcile,
  poolSupported,
  reconcile,
  resetSupportCache,
};
