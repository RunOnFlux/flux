const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');

describe('appRemovedMessage', () => {
  const atFloor = (minimumFluxOSAllowedVersion) => proxyquire('../../ZelBack/src/services/utils/appRemovedMessage', {
    config: { minimumFluxOSAllowedVersion, fluxapps: { appRemovedListFrom: '8.25.0' } },
    '../serviceHelper': serviceHelper,
  });

  it('names one app while a node below the first release that reads lists may be on the network', () => {
    expect(atFloor('8.24.9').namesSeveralApps()).to.equal(false);
  });

  it('names several once every node on the network reads them', () => {
    expect(atFloor('8.25.0').namesSeveralApps()).to.equal(true);
    expect(atFloor('8.26.1').namesSeveralApps()).to.equal(true);
  });
});
