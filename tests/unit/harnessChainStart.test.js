// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const config = require('config');
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
// stopped being the production rule. This is the check that would have caught it
// the day the constant was added.
//
// Lives in the unit suite deliberately: it runs on every push, where the harness
// runs by hand. It costs nothing and answers in seconds.
describe('harness chain start', () => {
  // Keys whose names look like heights but are DURATIONS - a number of blocks, not
  // a point in the chain. Excluded because they are free to exceed the chain start
  // without meaning anything is wrong. A duration missed here fails loudly and
  // harmlessly; a HEIGHT missed here is silent, which is why the match below is a
  // name pattern rather than a list of known gates.
  const DURATIONS = new Set([
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

  const gates = () => {
    const found = [];
    const walk = (value, path) => {
      if (!value || typeof value !== 'object') return;
      Object.entries(value).forEach(([key, entry]) => {
        const at = path ? `${path}.${key}` : key;
        if (entry && typeof entry === 'object') return walk(entry, at);
        if (typeof entry !== 'number') return;
        if (!/block|height|fork/i.test(at)) return;
        if (DURATIONS.has(at)) return;
        return found.push({ at, height: entry });
      });
    };
    walk(config.fluxapps, 'fluxapps');
    walk(config.daemon, 'daemon');
    return found;
  };

  it('starts above every block-height gate in the production config', () => {
    const above = gates().filter((gate) => gate.height >= DEFAULT_INITIAL_HEIGHT);

    expect(
      above,
      `${above.map((g) => `${g.at}=${g.height}`).join(', ')} is at or above the harness chain start `
      + `(${DEFAULT_INITIAL_HEIGHT}). Raise DEFAULT_INITIAL_HEIGHT in `
      + 'test-infra/runner/framework/chain-start.cjs above it, or - if a suite is meant to run '
      + 'before that fork - give that suite its own createTestEnv({ initialHeight }) and add the '
      + 'key here only if it is a duration rather than a height.',
    ).to.deep.equal([]);
  });

  it('finds gates to check at all, so a broken scan cannot pass quietly', () => {
    // Without this, renaming a config section makes the assertion above vacuous:
    // an empty list is trivially below any start.
    const found = gates();

    expect(found.length, 'no block-height gates found - the scan is looking in the wrong place').to.be.greaterThan(10);
    expect(found.map((gate) => gate.at)).to.include('fluxapps.minimumInstancesV8Block');
  });
});
