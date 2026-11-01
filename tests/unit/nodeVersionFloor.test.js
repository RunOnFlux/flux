const { expect } = require('chai');
const packageJson = require('../../package.json');
const productionConfig = require('../../ZelBack/config/default');

// The Node.js FluxOS runs on is the one the network holds every node to.
describe('Node.js version floor', () => {
  it('declares in package.json the floor the network holds a node to', () => {
    expect(packageJson.engines?.node).to.equal(`>=${productionConfig.minimumNodeJsAllowedVersion}`);
  });
});
