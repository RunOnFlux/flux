const fs = require('fs');
const os = require('os');
const path = require('path');

const { expect } = require('chai');
const sinon = require('sinon');
const express = require('express');
const request = require('supertest');
const proxyquire = require('proxyquire').noPreserveCache();

const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const volumeService = require('../../ZelBack/src/services/utils/volumeService');
const generalService = require('../../ZelBack/src/services/generalService');

// A multipart part names its file twice: once as its own filename, and once as
// the form field it arrives under. The browser sends the same string for both,
// and the node used to build the path it writes to out of the field name
// directly - so a field named for a path outside the share wrote there, as the
// node's own user. Driven through a real request because the defect was in how
// the handler wired formidable up, not in anything formidable does.
describe('fluxshare upload writes only inside the share', () => {
  let root;
  let shareDir;
  let fluxshareService;
  let app;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxshare-'));
    shareDir = path.join(root, 'ZelApps', 'ZelShare');
    fs.mkdirSync(shareDir, { recursive: true });
    // An existing directory beside the share: the write needs its parent to be
    // there already, so this is the reachable target rather than a hypothetical.
    fs.mkdirSync(path.join(root, 'outside'), { recursive: true });

    process.env.FLUX_APPS_FOLDER = path.join(root, 'ZelApps');
    fluxshareService = proxyquire('../../ZelBack/src/services/fluxshareService', {});

    sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
    sinon.stub(volumeService, 'capacityVolumesInGib').resolves([{ size: 1000 }]);
    sinon.stub(generalService, 'getNewNodeTier').resolves('cumulus');

    app = express();
    app.post('/apps/fluxshare/uploadfile/:folder?', (req, res) => fluxshareService.fluxShareUpload(req, res));
  });

  afterEach(() => {
    sinon.restore();
    delete process.env.FLUX_APPS_FOLDER;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('stores an ordinary upload under the share, named as the browser sent it', async () => {
    await request(app)
      .post('/apps/fluxshare/uploadfile')
      .attach('notes.txt', Buffer.from('hello'), { filename: 'notes.txt' });

    expect(fs.readdirSync(shareDir)).to.deep.equal(['notes.txt']);
    expect(fs.readFileSync(path.join(shareDir, 'notes.txt'), 'utf8')).to.equal('hello');
  });

  // Each of these resolves to a DIFFERENT existing directory, because the write
  // only lands if its parent is already there - a name whose parent does not
  // exist fails for that reason alone and would pass this whether the handler
  // was fixed or not. Every one of them writes outside the share when the field
  // name is used as the path, so each is a canary for the original defect.
  const escapes = [
    { what: 'a relative path out of the share', name: '../../outside/pwned', lands: ['outside', 'pwned'] },
    { what: 'a path that climbs and normalises back', name: '../../outside/./pwned2', lands: ['outside', 'pwned2'] },
    { what: 'a single climb into the apps folder', name: '../pwned3', lands: ['ZelApps', 'pwned3'] },
  ];

  escapes.forEach(({ what, name, lands }) => {
    it(`writes nothing outside the share for ${what}`, async () => {
      const target = path.join(root, ...lands);
      expect(fs.existsSync(path.dirname(target)), 'the test target parent must exist or this proves nothing').to.equal(true);

      await request(app)
        .post('/apps/fluxshare/uploadfile')
        .attach(name, Buffer.from('owned'), { filename: name });

      expect(fs.existsSync(target), `escaped the share to ${target}`).to.equal(false);

      const written = fs.readdirSync(shareDir);
      expect(written.some((entry) => entry.includes('..') || entry.includes('/')), `share holds a traversing name: ${written}`).to.equal(false);
    });
  });
});
