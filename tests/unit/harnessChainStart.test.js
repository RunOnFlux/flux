const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { DEFAULT_INITIAL_HEIGHT } = require('../../test-infra/runner/framework/chain-start.cjs');

// The harness chain has to start ABOVE every block-height gate in the production
// config, or every suite silently runs on the wrong side of a fork. The validator
// takes a height as an ARGUMENT rather than reading the tip - which is also why the
// pre-fork branches are live code, replayed by every node that syncs the app
// message history - so a chain that starts below a gate exercises the old branch of
// every rule keyed on it, for every suite, with nothing to say so.
//
// That is not hypothetical. The start was set just above daemonPONFork when that
// was the highest gate; minimumInstancesV8Block landed later at 2176519; and the
// harness compensated by lowering the FORK for every suite, so the rule under test
// stopped being the production rule.
//
// READ FROM THE FILE, NOT THROUGH node-config. This test used to set
// NODE_CONFIG_DIR to tests/unit/globalconfig and require('config'), so it scanned
// a hand-maintained COPY while its own message said "the production config". The
// regression it exists to catch is precisely a production-only change, and it was
// mutation-confirmed blind to exactly that: raising minimumInstancesV8Block in
// ZelBack/config/default.js left it green. The two files agreeing today is a
// coincidence of being in sync, not something this asserted.
//
// Lives in the unit suite deliberately: it runs on every push, where the harness
// runs by hand. It costs nothing and answers in seconds.
// Evaluated as CJS by hand, because test-infra/package.json declares
// "type": "module": a bare require() from here parses shared.js as ESM and
// answers an EMPTY object - a scan of nothing, green forever. In the harness
// the config directory is mounted into the FluxOS container without that
// package.json above it, so CJS is how the file runs where it is consumed.
const requireShared = () => {
  const src = fs.readFileSync(path.join(__dirname, '../../test-infra/config/shared.js'), 'utf8');
  const sandbox = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', src)(sandbox, sandbox.exports);
  return sandbox.exports;
};

// Each config carries a sentinel gate the scan must find, and a floor on how
// many gates the scan must yield: an empty or misparsed file is trivially
// below every start, so "found nothing" has to be a failure, not a pass.
const CONFIGS = {
  production: {
    config: require(path.join(__dirname, '../../ZelBack/config/default.js')),
    sentinel: 'fluxapps.minimumInstancesV8Block',
    atLeast: 10,
  },
  'the unit-test copy': {
    config: require(path.join(__dirname, 'globalconfig/default.js')),
    sentinel: 'fluxapps.minimumInstancesV8Block',
    atLeast: 10,
  },
  // The overlay merged over the production config on every harness node: a
  // fork lowered here is lowered for every suite, invisibly to the two files
  // above.
  'the harness overlay': {
    config: requireShared(),
    sentinel: 'fluxapps.daemonPONFork',
    atLeast: 3,
  },
};

describe('harness chain start', () => {
  // The scan is an ALLOW-LIST of what a large number is permitted to be, not a
  // guess at which key names look like heights.
  //
  // It used to match /block|height|fork/i, which reads the namer's mind: it misses
  // multisigAddressChange, epochstart, publicepochstart, applyMinimumPriceOn3Instances
  // and applyMinimumForExtraInstances - all live gates - and "a top-level constant
  // named ...Start" is how the two most recent ones were named. A gate that is
  // missed here is missed silently, which is the failure this whole file exists to
  // prevent, so the burden is the other way round: every number must be below the
  // chain start unless it is something a height cannot be.
  //
  // Durations in milliseconds are named ...Ms throughout, sometimes on a parent
  // (spawnDeferrals.targetedNodesMs.standard, crashBackoffDelaysMs.4).
  const MILLISECONDS = /(^|\.)[A-Za-z0-9]*Ms(\.|$)/;
  // Sizes in bytes.
  const BYTES = /(Size|Bytes)(\.|$)/i;
  // Counts of blocks - a span, not a point in the chain, so free to exceed the
  // start without meaning anything is wrong.
  const BLOCK_COUNTS = new Set([
    'fluxapps.maxBlocksAllowance',
    'fluxapps.postPonMaxBlocksAllowance',
    'fluxapps.minBlocksAllowance',
    'fluxapps.newMinBlocksAllowance',
    'fluxapps.blocksAllowanceInterval',
    'fluxapps.blocksLasting',
    'fluxapps.cancel1BlockMinBlocksAllowance',
    'fluxapps.explorerDeepRestoreBlocks',
    'fluxapps.hashSyncFallbackRecheckBlocks',
  ]);

  // Whole tree, from the root: messagesBroadcastRefactorStart (1751250) and
  // deterministicNodesStart (558000) are top-level and were never reached by a
  // scan that descended only fluxapps and daemon.
  const gates = (config) => {
    const found = [];
    const walk = (value, prefix) => {
      if (!value || typeof value !== 'object') return;
      Object.entries(value).forEach(([key, entry]) => {
        const at = prefix ? `${prefix}.${key}` : key;
        if (entry && typeof entry === 'object') {
          walk(entry, at);
          return;
        }
        // A height held as a string is still a height.
        const height = typeof entry === 'number' ? entry : Number(entry);
        if (!Number.isFinite(height)) return;
        if (MILLISECONDS.test(at) || BYTES.test(at) || BLOCK_COUNTS.has(at)) return;
        found.push({ at, height });
      });
    };
    walk(config, '');
    return found;
  };

  Object.entries(CONFIGS).forEach(([which, { config, sentinel, atLeast }]) => {
    it(`starts above every block-height gate in ${which}`, () => {
      const above = gates(config).filter((gate) => gate.height >= DEFAULT_INITIAL_HEIGHT);

      expect(
        above,
        `${above.map((g) => `${g.at}=${g.height}`).join(', ')} in ${which} is at or above the harness `
        + `chain start (${DEFAULT_INITIAL_HEIGHT}). Raise DEFAULT_INITIAL_HEIGHT in `
        + 'test-infra/runner/framework/chain-start.cjs above it, or - if a suite is meant to run '
        + 'before that fork - give that suite its own createTestEnv({ initialHeight }). If the key '
        + 'is not a height at all, add it to BLOCK_COUNTS above with the reason.',
      ).to.deep.equal([]);
    });

    it(`finds gates to check at all in ${which}, so a broken scan cannot pass quietly`, () => {
      // Without this, renaming a config section makes the assertion above vacuous:
      // an empty list is trivially below any start.
      const found = gates(config);

      expect(found.length, 'no gates found - the scan is looking in the wrong place').to.be.greaterThan(atLeast);
      expect(found.map((gate) => gate.at)).to.include(sentinel);
    });
  });

  it('reaches the gates a name-based scan used to miss', () => {
    // Each of these is a live gate whose name contains none of block, height or
    // fork. They are all below the start today, so the assertion above is green
    // either way - which is exactly why their absence went unnoticed.
    const scanned = gates(CONFIGS.production.config).map((gate) => gate.at);

    expect(scanned).to.include.members([
      'messagesBroadcastRefactorStart',
      'deterministicNodesStart',
      'fluxapps.multisigAddressChange',
      'fluxapps.epochstart',
      'fluxapps.publicepochstart',
      'fluxapps.applyMinimumPriceOn3Instances',
      'fluxapps.applyMinimumForExtraInstances',
    ]);
  });
});
