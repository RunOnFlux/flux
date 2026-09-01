// The block height the harness chain starts at, and the single place it is written.
//
// It has to sit ABOVE every block-height gate in ZelBack/config/default.js, or the
// suites silently run on the wrong side of a fork: the validator takes a height as
// an argument rather than reading the tip, so a chain that starts below a fork
// exercises the pre-fork branch of every rule keyed on it.
//
// That is exactly how the minimumInstancesV8Block override came to exist. The start
// was set just above daemonPONFork (2020000) when that was the highest gate, a
// higher one landed later at 2176519, and the harness compensated by lowering the
// FORK for every suite - so the rule under test stopped being the production rule.
//
// CommonJS, and required rather than duplicated, because the guard test in
// tests/unit reads this same file. Two copies of this number is the trap being
// removed, not a detail.
//
// Pinned by tests/unit/harnessChainStart.test.js, which fails if any gate in the
// production config rises above it. A suite that WANTS to be before a fork asks
// for it: createTestEnv({ initialHeight }).
module.exports = { DEFAULT_INITIAL_HEIGHT: 2200000 };
