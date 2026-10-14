// The hooks under a mocha suite that failed, depth first.
//
// Mocha marks a failed hook `state: 'failed'` and leaves it on its suite, so a hook
// that runs after it can see the failure. Every test a failed hook skipped is left
// unrun, and an unrun test cannot tell that apart from one `--grep` filtered out:
// the hook's own state is the only signal that something went wrong.
//
// CommonJS so the unit suite can require it.

const HOOK_TYPES = ['beforeAll', 'beforeEach', 'afterEach', 'afterAll'];

function failedHooks(suite) {
  const own = HOOK_TYPES.flatMap((type) => suite.getHooks(type) || [])
    .filter((hook) => hook.state === 'failed');
  return own.concat(suite.suites.flatMap(failedHooks));
}

module.exports = { failedHooks };
