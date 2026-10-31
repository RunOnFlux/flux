/**
 * Which user of a host port holds it now.
 *
 * Three things on a node listen on host ports that an app will use: the
 * availability check, an install's port test, and an install's containers. Each
 * claims the ports before it listens and releases them once it has stopped
 * listening, so no two of them listen on one port at once.
 *
 * A claim is held from `claim` to `release` and by nothing else: there is no
 * expiry. Every holder releases on each of its ways out, and a release deletes
 * the claim's ports from the register and wakes whoever was waiting for them,
 * so the register holds exactly the ports someone is using now.
 */

const fluxEventBus = require('../utils/fluxEventBus');

const ClaimKind = Object.freeze({
  // The availability check: one port, held for one test of a few seconds.
  CHECK: 'check',
  // An install: an app's ports, from its port test until its containers have
  // started or the install has ended without them.
  INSTALL: 'install',
});

// Host port -> the claim holding it.
const holders = new Map();
// Callers waiting for ports to have no claim: { ports, resolve }.
const waiters = new Set();

/**
 * The claim holding any of `ports`, or null when none is held.
 * @param {number[]} ports
 * @returns {{ports: number[], kind: string, owner: string}|null}
 */
function holderOf(ports) {
  // eslint-disable-next-line no-restricted-syntax
  for (const port of ports) {
    const holder = holders.get(Number(port));
    if (holder) return holder;
  }
  return null;
}

/**
 * Claims every one of `ports`, or none of them when any is already held.
 * @param {number[]} ports
 * @param {string} kind One of ClaimKind.
 * @param {string} owner Who holds the claim: an app name, or the check.
 * @returns {{ports: number[], kind: string, owner: string}|null} The claim,
 *   to be passed to `release`; null when a port is held.
 */
function claim(ports, kind, owner) {
  const distinct = [...new Set(ports.map(Number))];
  if (holderOf(distinct)) return null;
  const held = Object.freeze({ ports: distinct, kind, owner });
  distinct.forEach((port) => holders.set(port, held));
  return held;
}

/**
 * Ends `held`, and wakes every caller whose ports are now all free. Releasing a
 * claim that has already ended, or null, does nothing.
 * @param {{ports: number[]}|null} held
 * @returns {void}
 */
function release(held) {
  if (!held) return;
  held.ports.forEach((port) => {
    if (holders.get(port) === held) holders.delete(port);
  });
  waiters.forEach((waiter) => {
    if (holderOf(waiter.ports)) return;
    waiters.delete(waiter);
    waiter.resolve();
  });
}

/**
 * Resolves once none of `ports` is claimed.
 * @param {number[]} ports
 * @returns {Promise<void>}
 */
function whenFree(ports) {
  if (!holderOf(ports)) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.add({ ports, resolve });
  });
}

// The steps of an install that claim its ports.
const InstallStep = Object.freeze({
  // The test that the app's ports are reachable, before the install itself.
  PORT_TEST: 'portTest',
  // The install, which starts the app's containers on them.
  INSTALL: 'install',
});

/**
 * Claims an install's ports. A port the availability check holds is waited for,
 * since the check holds one for a few seconds; a port another install holds is
 * not, since that install has the ports until its containers are running.
 * @param {number[]} ports
 * @param {string} appName
 * @param {string} step One of InstallStep: which step of the install claims them.
 * @returns {Promise<{claim: object|null, heldBy: object|null}>} The claim, or
 *   null and the install that holds a port.
 */
async function claimForInstall(ports, appName, step) {
  const held = claim(ports, ClaimKind.INSTALL, appName);
  if (held) return { claim: held, heldBy: null };
  const holder = holderOf(ports);
  if (holder.kind !== ClaimKind.CHECK) return { claim: null, heldBy: holder };
  fluxEventBus.publish('ports:awaitingRelease', {
    appName, step, ports: holder.ports, holder: holder.owner,
  });
  await whenFree(holder.ports);
  return claimForInstall(ports, appName, step);
}

/**
 * The ports claimed now.
 * @returns {number[]}
 */
function claimedPorts() {
  return [...holders.keys()];
}

/**
 * How many callers are waiting for ports to be released.
 * @returns {number}
 */
function waiting() {
  return waiters.size;
}

module.exports = {
  ClaimKind,
  InstallStep,
  claim,
  claimForInstall,
  claimedPorts,
  holderOf,
  release,
  waiting,
  whenFree,
};
