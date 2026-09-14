const { execFileSync } = require('node:child_process');
const nodePath = require('node:path');

const { expect } = require('chai');

const ROOT = nodePath.join(__dirname, '../..');

// Every tracked file carrying private key material, as a whole list.
//
// A real certificate authority lived in certs/ for two years - CA:TRUE, valid
// to 2043, its private key beside it - shipped to every node because the repo
// is what a node pulls. It was written for an afternoon's attempt at verifying
// node TLS, reverted the same day, and then simply not noticed: nothing
// referenced it, so nothing complained.
//
// Listing what IS here rather than asserting what is not, because "no private
// keys are committed" passes just as well over a sweep that found nothing at
// all. Every entry below is a fixture or a documentation placeholder. A new one
// appearing fails this, and has to be looked at and named before it can pass.
describe('private key material in the tree', () => {
  // Assembled rather than written out, so this file does not match its own
  // search and report itself. It did, the first time.
  const marker = ['PRIVATE', 'KEY-----'].join(' ');

  const expected = [
    'docs/registry-auth/REPOAUTH_STRING_FORMAT.md',
    'docs/registry-auth/google-gar/GOOGLE_GAR_SETUP.md',
    'test-infra/fixtures/registry-tls/server-key.pem',
    'tests/ZelBack/apiTests.js',
    'tests/unit/registryAuth/authProviderFactory.test.js',
    'tests/unit/registryAuth/googleGarAuthProvider.test.js',
    'tests/unit/registryAuth/integration/README.md',
  ];

  it('is exactly these files, each a fixture or a placeholder', () => {
    let found = [];
    try {
      found = execFileSync('git', ['-C', ROOT, 'grep', '-lI', '--', marker], { encoding: 'utf8' })
        .split('\n').filter(Boolean).sort();
    } catch (error) {
      // git grep exits 1 on no match, which would otherwise read as a pass.
      if (error.status !== 1) throw error;
    }

    expect(found).to.deep.equal(expected);
  });
});
