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
});
