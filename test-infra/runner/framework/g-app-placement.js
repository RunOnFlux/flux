// Where a `g:` app's writer ends up, and how a suite arranges for it to end up
// somewhere in particular.
//
// TWO ORDERINGS decide what a g: app looks like on a fleet, and different things
// set them:
//
//   the WRITER   the holder that gets the writable folder at a cold start and
//                runs the component. It is the LOWEST IP among the holders - the
//                syncthing state machine's designated leader - and the election
//                does not choose it.
//   the ORDER    runningSince ascending, which records the order the holders
//                were PLACED. masterSlaveApps ranks its senior end; the surplus
//                rule and the evacuation queue rank its junior end.
//
// ELECTING A MASTER DOES NOT MOVE THE WRITER. FDM reports which node is primary;
// it does not start containers, and the election refuses to start a second
// writer while a peer is running one - the split-brain guard. A suite that wants
// the writer in a particular position must PLACE the holders so it lands there,
// and suite 96 spent three minutes of its first run waiting on a container that
// was never going to start because it tried to elect one instead.
//
// Owned here because three suites depend on this and each used to restate it in
// its own words, hand-deriving a placement order from it. A fact written down in
// three places is a fact that drifts in two of them.
//
// Pure, and deliberately dependent on nothing but the subnet layout, so the
// orders it produces are unit-testable without a fleet.

import { getSubnetConfig } from './subnet-config.js';

const defaultIpOf = (index) => getSubnetConfig().nodeIp(index + 1);

/**
 * Numeric IP ordering. A lexical compare puts `.10` before `.9`, which is the
 * kind of thing that is right for every fixture anyone happens to write and
 * wrong for the first one that spans the boundary.
 * @param {string} a Dotted-quad address.
 * @param {string} b Dotted-quad address.
 * @returns {number} Comparator result.
 */
function compareIps(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Which holder will seed the folder, and therefore run the g: component.
 * @param {number[]} holders Node indices holding the app.
 * @param {Function} [ipOf] Index to address, injectable for tests.
 * @returns {number} The seeding holder's node index.
 */
export function syncthingSeedIndex(holders, ipOf = defaultIpOf) {
  if (!Array.isArray(holders) || !holders.length) {
    throw new Error('syncthingSeedIndex: holders must be a non-empty array of node indices');
  }
  return [...holders].sort((a, b) => compareIps(ipOf(a), ipOf(b)))[0];
}

/**
 * A placement order that lands the seed at a chosen position in the instance
 * order - which is the same thing as its election index, because both are
 * runningSince ascending and placement is what sets runningSince.
 *
 * Position 0 is the SENIOR end (first placed, lowest election index); the last
 * position is the newest copy, which is the one the surplus rule and the
 * evacuation queue pick first.
 * @param {number[]} holders Node indices holding the app.
 * @param {number} seedPosition Where the seed should land, 0-based.
 * @param {Function} [ipOf] Index to address, injectable for tests.
 * @returns {number[]} Placement order for placeGAppInOrder.
 */
export function placementOrderWithSeedAt(holders, seedPosition, ipOf = defaultIpOf) {
  const seed = syncthingSeedIndex(holders, ipOf);
  if (!Number.isInteger(seedPosition) || seedPosition < 0 || seedPosition >= holders.length) {
    // Thrown rather than clamped: a position off the end means the caller has a
    // different fleet in mind than the one it is describing, and clamping would
    // hand it a plausible order for the wrong shape.
    throw new Error(
      `placementOrderWithSeedAt: seedPosition ${seedPosition} is outside 0..${holders.length - 1}`,
    );
  }
  const others = holders.filter((index) => index !== seed);
  return [...others.slice(0, seedPosition), seed, ...others.slice(seedPosition)];
}
