// The released FluxOS a suite that upgrades a node starts that node on, declared on the
// suite's first line:
//
//   // upgrades-from: release    the latest release: a rolling upgrade from whatever the
//                                fleet runs to this tree, true of every release
//   // upgrades-from: v8.21.1    that release: a transitional suite, which tests one
//                                version-to-version change and means something only
//                                while nodes run that release
//
// The node image of that release is built by build-release-image.sh under a tag named
// for the release's commit and this clone's harness, so an image built under another
// harness is never taken for it. ensure-upgrade-bases.sh builds the ones a host lacks.
//
//   node framework/upgrade-base.js <suite>...   one line per declaring suite:
//                                               file, declared, ref, image tag
//   node framework/upgrade-base.js --list       every declaring suite in tests/, the
//                                               transitional ones marked
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLONE = path.resolve(RUNNER, '../..');
const MARKER = /^\/\/ upgrades-from: (release|v\d+\.\d+\.\d+)$/;
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

function git(...args) {
  return execFileSync('git', ['-C', CLONE, ...args], { encoding: 'utf8' }).trim();
}

/**
 * What a suite declares it upgrades from: 'release', a release tag, or null.
 * @param {string} file
 * @returns {string|null}
 */
export function upgradesFrom(file) {
  const [first] = readFileSync(file, 'utf8').split('\n', 1);
  return MARKER.exec(first)?.[1] ?? null;
}

/**
 * The latest release tag in this clone.
 * @returns {string}
 */
export function latestRelease() {
  const [latest] = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter((tag) => RELEASE_TAG.test(tag));
  if (!latest) throw new Error(`no release tag (vX.Y.Z) in ${CLONE}: push the release tags to this clone`);
  return latest;
}

/**
 * The node image a suite starts its upgraded nodes on.
 * @param {string} file the suite's path
 * @returns {{declared: string, ref: string, commit: string, tag: string}}
 */
export function upgradeBase(file) {
  const declared = upgradesFrom(file);
  if (!declared) throw new Error(`${path.basename(file)} declares no "// upgrades-from:" on its first line`);
  const ref = declared === 'release' ? latestRelease() : declared;
  let commit;
  try {
    commit = git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    throw new Error(`${ref} is not in ${CLONE}: push the release tags to this clone`);
  }
  const harness = git('rev-parse', 'HEAD:test-infra');
  return {
    declared, ref, commit, tag: `base-${commit.slice(0, 12)}-${harness.slice(0, 12)}`,
  };
}

function main(args) {
  if (args[0] === '--list') {
    const tests = path.join(RUNNER, 'tests');
    readdirSync(tests).filter((name) => name.endsWith('.js')).sort().forEach((name) => {
      const declared = upgradesFrom(path.join(tests, name));
      if (declared) console.log(`${declared === 'release' ? 'rolling     ' : 'transitional'}  ${declared.padEnd(9)}  ${name}`);
    });
    return;
  }
  args.filter((file) => upgradesFrom(file)).forEach((file) => {
    const { declared, ref, tag } = upgradeBase(file);
    console.log([file, declared, ref, tag].join('\t'));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`upgrade-base: ${error.message}`);
    process.exit(2);
  }
}
