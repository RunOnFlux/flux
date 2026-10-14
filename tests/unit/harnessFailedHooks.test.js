const { expect } = require('chai');
const Mocha = require('mocha');
const { failedHooks } = require('../../test-infra/runner/framework/failed-hooks.cjs');

// The harness dumps node logs from an after-all hook when any hook under the suite
// failed. These run a real mocha over each shape, so they test the state mocha
// actually leaves, not a copy of it.
describe('harness failedHooks', () => {
  const { Suite, Test } = Mocha;
  const pass = () => {};
  const fail = () => { throw new Error('boom'); };

  // Builds a root suite with build(root), runs it silently, and answers what
  // failedHooks saw from the root's own after-all hook, as the harness asks it.
  const run = (build, opts = {}) => new Promise((resolve) => {
    const mocha = new Mocha({ reporter: function silent() {}, ...opts });
    const root = Suite.create(mocha.suite, 'root');
    let seen;
    root.afterAll(function () { seen = failedHooks(this.test.parent).map((h) => h.fullTitle()); });
    build(root);
    mocha.run(() => resolve(seen));
  });

  it('finds a nested before-all that fails after a test has passed', async () => {
    const seen = await run((root) => {
      root.addTest(new Test('passes', pass));
      const nested = Suite.create(root, 'nested');
      nested.beforeAll('setup', fail);
      nested.addTest(new Test('never runs', pass));
    });
    expect(seen).to.deep.equal(['root nested "before all" hook: setup for "never runs"']);
  });

  it('finds a failing before-each', async () => {
    const seen = await run((root) => {
      root.beforeEach('each', fail);
      root.addTest(new Test('never runs', pass));
    });
    expect(seen).to.have.length(1);
    expect(seen[0]).to.include('"before each" hook: each');
  });

  it('finds a nested after-all that fails', async () => {
    const seen = await run((root) => {
      const nested = Suite.create(root, 'nested');
      nested.addTest(new Test('passes', pass));
      nested.afterAll('teardown', fail);
    });
    expect(seen).to.have.length(1);
    expect(seen[0]).to.include('"after all" hook: teardown');
  });

  it('finds nothing when every hook passed, though a test failed', async () => {
    const seen = await run((root) => {
      root.beforeAll('setup', pass);
      root.addTest(new Test('fails', fail));
    });
    expect(seen).to.deep.equal([]);
  });

  it('finds nothing when --grep left tests unrun', async () => {
    const seen = await run((root) => {
      root.beforeAll('setup', pass);
      root.addTest(new Test('selected', pass));
      root.addTest(new Test('filtered out', pass));
    }, { grep: 'selected' });
    expect(seen).to.deep.equal([]);
  });
});
