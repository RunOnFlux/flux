const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');
const linkCrypto = require('../../ZelBack/src/services/utils/linkCrypto');

const SOURCE = path.join(__dirname, '../../ZelBack/src/services/utils/linkCrypto.js');

describe('linkCrypto tests', () => {
  it('requires nothing but node:crypto, so the peer stub runs it as the node image ships it', () => {
    const required = [...fs.readFileSync(SOURCE, 'utf8').matchAll(/require\(\s*'([^']+)'\s*\)/g)].map(([, name]) => name);
    expect(required).to.eql(['node:crypto']);
  });

  it('opens a frame sealed under the same key, and no other', () => {
    const key = Buffer.alloc(32, 7);
    const sealed = linkCrypto.sealFrame(key, '{"a":1}');

    expect(linkCrypto.openFrame(key, sealed)).to.equal('{"a":1}');
    expect(linkCrypto.openFrame(Buffer.alloc(32, 8), sealed)).to.equal(null);
    expect(linkCrypto.openFrame(key, sealed.replace('"a"', '"b"'))).to.equal(null);
  });

  it('derives one transcript at both ends of a link', () => {
    const a = {
      localNonce: 'n1', peerNonce: 'n2', localPubKey: 'k1', peerPubKey: 'k2', localIp: '10.0.0.1', peerIp: '10.0.0.2',
    };
    const b = {
      localNonce: 'n2', peerNonce: 'n1', localPubKey: 'k2', peerPubKey: 'k1', localIp: '10.0.0.2', peerIp: '10.0.0.1',
    };
    expect(linkCrypto.transcript(a)).to.equal(linkCrypto.transcript(b));
    expect(linkCrypto.transcript({ ...a, peerIp: '10.0.0.66' })).to.not.equal(linkCrypto.transcript(b));
  });
});
