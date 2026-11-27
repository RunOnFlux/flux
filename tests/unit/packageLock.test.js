const { expect } = require('chai');

const pkg = require('../../package.json');
const lock = require('../../package-lock.json');

// Every node installs from package-lock.json, and the image's build refuses one that does not
// match package.json. A dependency changed in package.json needs the lock regenerated with it:
// `npm install --package-lock-only`. The version fields are labels npm does not compare.
describe('package-lock.json', () => {
  const root = lock.packages[''];

  ['dependencies', 'devDependencies', 'optionalDependencies'].forEach((field) => {
    it(`locks the ${field} package.json names`, () => {
      expect(root[field] || {}).to.deep.equal(pkg[field] || {});
    });
  });

  // A legacy node's `npm start` installs with --legacy-peer-deps, which leaves out a package only
  // a peer dependency reaches and rewrites the lock on disk without it. A modified tracked lock
  // makes `git checkout` refuse the team's branch switch.
  it('holds no package that only a peer dependency reaches', () => {
    const { packages } = lock;

    /** Where npm resolves `name` from the package at `from`: its own node_modules, then each parent's. */
    function resolve(from, name) {
      let dir = from;
      for (;;) {
        const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
        if (packages[candidate]) return candidate;
        if (!dir) return null;
        const cut = dir.lastIndexOf('/node_modules/');
        dir = cut === -1 ? '' : dir.slice(0, cut);
      }
    }

    const reached = new Set(['']);
    const pending = [''];
    while (pending.length) {
      const at = pending.pop();
      const entry = packages[at];
      const fields = at === '' ? ['dependencies', 'devDependencies', 'optionalDependencies'] : ['dependencies', 'optionalDependencies'];
      const targets = fields.flatMap((field) => Object.keys(entry[field] || {})).map((name) => resolve(at, name));
      if (entry.link) targets.push(entry.resolved);
      targets.filter((target) => target !== null && !reached.has(target)).forEach((target) => {
        reached.add(target);
        pending.push(target);
      });
    }

    expect(Object.keys(packages).filter((at) => !reached.has(at))).to.deep.equal([]);
  });
});
