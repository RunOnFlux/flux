const { expect } = require('chai');

const fluxStorage = require('../../ZelBack/src/services/utils/fluxStorage');

describe('flux storage links', () => {
  // The two markers the node dereferences before it starts a container. A
  // parameter that is not one of them carries no link, however URL-shaped it is
  // - F_S_CONTACTS above all, which has the same form and is never fetched.
  describe('which parameters carry a link', () => {
    it('reads the link out of the markers the node fetches', () => {
      expect(fluxStorage.storageLinkOf('F_S_ENV=https://storage.runonflux.io/v1/env/1')).to.equal('https://storage.runonflux.io/v1/env/1');
      expect(fluxStorage.storageLinkOf('F_S_CMD=https://storage.runonflux.io/v1/cmd/1')).to.equal('https://storage.runonflux.io/v1/cmd/1');
    });

    // The whole of the parameter after the marker, so the link the door
    // approved is the link the fetch requests - a second occurrence of the
    // marker inside a query truncates a split, and does not truncate this.
    it('reads the link a marker carries whatever the link contains', () => {
      expect(fluxStorage.storageLinkOf('F_S_ENV=https://storage.runonflux.io/v1/env/1?x=F_S_ENV=y'))
        .to.equal('https://storage.runonflux.io/v1/env/1?x=F_S_ENV=y');
    });

    it('reads no link out of anything else', () => {
      expect(fluxStorage.storageLinkOf('F_S_CONTACTS=https://storage.runonflux.io/v1/contacts/1')).to.equal(null);
      expect(fluxStorage.storageLinkOf('DATABASE_URL=https://example.com')).to.equal(null);
      expect(fluxStorage.storageLinkOf(undefined)).to.equal(null);
    });
  });

  describe('which links the node may fetch', () => {
    // The shapes every storage link on chain actually takes.
    const onChain = [
      'https://storage.runonflux.io/v1/env/777210342462760',
      'https://storage.runonflux.io/v2/env/presearch',
      'https://storage.runonflux.io/v1/cmd/918029783086795',
    ];

    onChain.forEach((link) => {
      it(`fetches ${link}`, () => {
        expect(fluxStorage.isFluxStorageUrl(link)).to.equal(true);
      });
    });

    // Each of these reads as though it names Flux storage, and a host check
    // written as a suffix or a substring test admits one or the other.
    const refused = [
      { what: 'a host that only ends with the storage name', link: 'https://storage.runonflux.io.example.com/v1/env/1' },
      { what: 'a host that carries the storage name in its path', link: 'https://example.com/storage.runonflux.io/v1/env/1' },
      { what: 'a host that carries the storage name in its query', link: 'https://example.com/v1/env/1?h=storage.runonflux.io' },
      { what: 'the storage name in userinfo', link: 'https://storage.runonflux.io@example.com/v1/env/1' },
      { what: 'plaintext http to the storage host', link: 'http://storage.runonflux.io/v1/env/1' },
      { what: 'a subdomain of the storage host', link: 'https://a.storage.runonflux.io/v1/env/1' },
      { what: 'the loopback address', link: 'http://127.0.0.1/v1/env/1' },
      { what: 'the cloud metadata address', link: 'http://169.254.169.254/latest/meta-data/' },
      { what: 'a non-http scheme', link: 'file:///etc/passwd' },
      { what: 'something that is not a URL', link: 'undefined' },
      { what: 'an empty link', link: '' },
      // An address is more than a host: a port names a different service on
      // the same machine, and userinfo makes the node send credentials the
      // specification author wrote over its own signed request.
      { what: 'another port on the storage host', link: 'https://storage.runonflux.io:8443/v1/env/1' },
      { what: 'the ssh port on the storage host', link: 'https://storage.runonflux.io:22/v1/env/1' },
      { what: 'credentials the author chose', link: 'https://user:pass@storage.runonflux.io/v1/env/1' },
      { what: 'a username with no password', link: 'https://user@storage.runonflux.io/v1/env/1' },
    ];

    refused.forEach(({ what, link }) => {
      it(`refuses ${what}`, () => {
        expect(fluxStorage.isFluxStorageUrl(link)).to.equal(false);
      });
    });
  });
});
