const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const config = require('config');

const { verifyBundle } = require('../../ZelBack/src/services/utils/policySignature');

// The REAL published bundle, against the REAL pinned keys, through the product's own
// verifier.
//
// Everything else that exercises this code signs its own input, which means the publisher
// and the consumer are never checked against each other. They are separate programs in
// separate repositories - scripts/sign-policy.js in fluxos-network-policy, and
// utils/policySignature.js here - and the only thing holding them together is that both
// sides believe the same thing about what is signed: the transmitted payload bytes, not a
// re-serialisation, with the signature detached beside them. A change to either that
// breaks that agreement would leave every test in this repo green and every node on the
// network unable to read policy.
//
// A FIXTURE rather than a fetch, on purpose. A test that reaches the network is a test
// that fails when github does, and the fleet suites deliberately reach nothing outside
// (suite 95 asserts exactly that). What is wanted here is not "is the bundle up" but "do
// these two programs still agree", and a recorded bundle answers that without a socket.
//
// REFRESHING IT. The fixture is a snapshot, so it catches a change on THIS side always,
// and a change on the publisher's side only when someone re-records it. Re-record after
// any change to how the bundle is built or signed:
//
//   curl -s https://raw.githubusercontent.com/RunOnFlux/fluxos-network-policy/signed/policy-signed.json \
//     -o tests/unit/fixtures/policy/policy-signed.live.json
//
// Recorded 2026-09-11 from seq 1, the first production signing run.

const FIXTURE = path.join(__dirname, 'fixtures', 'policy', 'policy-signed.live.json');

describe('the live published policy bundle', () => {
  const raw = fs.readFileSync(FIXTURE, 'utf8');

  it('verifies against the keys the fleet actually pins', () => {
    // config.policy.publicKeys, not a copy of them. A key removed from the release while
    // the published bundle is still signed by it is the failure this catches, and it
    // cannot be caught by a test that carries its own key list.
    let rejection = null;
    const payload = verifyBundle(raw, {
      publicKeys: config.policy.publicKeys,
      onReject: (reason) => { rejection = reason; },
    });
    expect(rejection, 'the shipped verifier rejected the shipped bundle').to.equal(null);
    expect(payload, 'the real bundle verifies under the real keys').to.not.equal(null);
  });

  it('carries the four documents the readers ask for, by the names they use', () => {
    const payload = verifyBundle(raw, { publicKeys: config.policy.publicKeys });
    // These strings are what enterpriseConfig, imageManager and
    // appTamperingBlocklistService pass to getDocument. A document renamed on the
    // publisher's side reads as absent here, and absent means UNKNOWN - so every node
    // would stop hosting enterprise apps and stop registering anything, quietly.
    expect(Object.keys(payload.documents).sort()).to.deep.equal([
      'blockedrepositories',
      'enterprisenodes',
      'tamperingblockednodes',
      'vettedrepositories',
    ]);
  });

  it('carries documents of the shapes the readers require', () => {
    const { documents } = verifyBundle(raw, { publicKeys: config.policy.publicKeys });
    expect(documents.blockedrepositories, 'blocked repositories is a list').to.be.an('array');
    expect(documents.vettedrepositories).to.be.an('array');
    expect(documents.tamperingblockednodes).to.be.an('array');
    // enterpriseConfig.isValidNodeOwnerMap: a plain object whose every value is an array
    // of strings. Anything else makes a node answer "policy unknown" and act on nothing.
    const map = documents.enterprisenodes;
    expect(map).to.be.an('object');
    expect(Array.isArray(map)).to.equal(false);
    Object.values(map).forEach((owners) => {
      expect(owners).to.be.an('array');
      owners.forEach((owner) => expect(owner).to.be.a('string'));
    });
  });

  it('is signed over the transmitted bytes, not over what they parse to', () => {
    // The agreement between the two programs, stated as a test.
    //
    // The payload is re-encoded PRETTY-PRINTED: identical JSON, different bytes. It must
    // not verify, because the signature covers the bytes as carried. A verifier that
    // parsed and re-encoded before checking would accept this - and would then reject
    // any real bundle whose spacing or key order differed from its own idea of canonical,
    // which is a failure that only appears in production and only for some documents.
    //
    // Worth noting why this is not the obvious round-trip: JSON.stringify(JSON.parse(x))
    // returns x byte-for-byte for this bundle, because the publisher emits the same
    // canonical form Node does. That version of the test passes without exercising
    // anything. The bytes have to actually change.
    const envelope = JSON.parse(raw);
    const parsed = JSON.parse(Buffer.from(envelope.payload_b64, 'base64').toString('utf8'));
    const pretty = Buffer.from(JSON.stringify(parsed, null, 2), 'utf8');
    expect(pretty.equals(Buffer.from(envelope.payload_b64, 'base64')), 'the bytes differ').to.equal(false);

    const reserialised = JSON.stringify({
      payload_b64: pretty.toString('base64'),
      sig_b64: envelope.sig_b64,
    });
    expect(
      verifyBundle(reserialised, { publicKeys: config.policy.publicKeys }),
      'a payload re-encoded to different bytes must not verify',
    ).to.equal(null);
  });

  it('is refused when the pinned keys do not include its signer', () => {
    // The control. Without it every assertion above could be satisfied by a verifier that
    // returns a payload for anything at all.
    const notOurs = '0'.repeat(63).concat('1');
    expect(
      verifyBundle(raw, { publicKeys: [notOurs] }),
      'a bundle signed by nobody we pin must be refused',
    ).to.equal(null);
  });
});
