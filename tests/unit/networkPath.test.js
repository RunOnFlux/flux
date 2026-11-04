const { expect } = require('chai');
const crypto = require('crypto');
const bitcoinMessage = require('bitcoinjs-message');
const hash = require('object-hash');
const networkPath = require('../../ZelBack/src/services/utils/networkPath');

describe('networkPath tests', () => {
  const key = () => crypto.randomBytes(32);
  const signerOf = (privateKey) => (text) => bitcoinMessage.sign(text, privateKey, true).toString('base64');
  const verifies = (privateKey, text, signature) => {
    const ecdh = crypto.createECDH('secp256k1');
    ecdh.setPrivateKey(privateKey);
    const ripe = crypto.createHash('ripemd160').update(crypto.createHash('sha256').update(ecdh.getPublicKey(null, 'compressed')).digest()).digest();
    const address = bitcoinMessage.sign('x', privateKey, true) && require('bs58check').encode(Buffer.concat([Buffer.from([0]), ripe]));
    return bitcoinMessage.verify(text, address, signature);
  };
  const message = () => ({
    version: 1, timestamp: 1000, pubKey: 'k', signature: 's', data: { type: 'fluxapprunning', name: 'app' },
  });

  it('adds a hop signed over the hash, the send time and the receiver, leaving the signed fields alone', () => {
    const a = key();
    const framed = JSON.parse(networkPath.framed(message(), signerOf(a), '1.1.1.1:16127', 1250));

    expect(framed.data).to.deep.equal(message().data);
    expect(framed.signature).to.equal('s');
    expect(framed.networkPath).to.have.length(1);
    expect(framed.networkPath[0][0]).to.equal(250);
    const text = networkPath.hopText(hash(message().data), 1250, '1.1.1.1:16127');
    expect(verifies(a, text, framed.networkPath[0][1])).to.equal(true);
  });

  it('chains each hop to the signature before it', () => {
    const a = key();
    const b = key();
    const first = JSON.parse(networkPath.framed(message(), signerOf(a), '2.2.2.2:16127', 1100));
    const second = JSON.parse(networkPath.framed(first, signerOf(b), '3.3.3.3:16127', 1300));

    expect(second.networkPath).to.have.length(2);
    const text = networkPath.hopText(first.networkPath[0][1], 1300, '3.3.3.3:16127');
    expect(verifies(b, text, second.networkPath[1][1])).to.equal(true);
  });

  it('fails verification when a hop names another receiver or another time', () => {
    const a = key();
    const framed = JSON.parse(networkPath.framed(message(), signerOf(a), '1.1.1.1:16127', 1250));
    const [, signature] = framed.networkPath[0];
    const h = hash(message().data);

    expect(verifies(a, networkPath.hopText(h, 1250, '9.9.9.9:16127'), signature)).to.equal(false);
    expect(verifies(a, networkPath.hopText(h, 1251, '1.1.1.1:16127'), signature)).to.equal(false);
  });

  describe('reading a path back', () => {
    const nodes = {};
    const add = (address) => {
      const privateKey = key();
      const ecdh = crypto.createECDH('secp256k1');
      ecdh.setPrivateKey(privateKey);
      const pubKey = ecdh.getPublicKey('hex', 'compressed');
      nodes[pubKey] = [address];
      return { privateKey, pubKey, address };
    };
    const addressesOf = async (pubKey) => nodes[pubKey] ?? [];
    const a = add('1.1.1.1:16127');
    const b = add('2.2.2.2:16127');
    const receivedVia = (signers) => {
      let current = message();
      signers.forEach(({ node, to, at }) => {
        current = JSON.parse(networkPath.framed(current, signerOf(node.privateKey), to, at));
      });
      return { hash: hash(message().data), timestamp: current.timestamp, networkPath: current.networkPath };
    };
    const chain = () => receivedVia([
      { node: a, to: b.address, at: 1100 }, { node: b, to: '9.9.9.9:16127', at: 1300 },
    ]);

    it('names each hop\'s signer, time and receiver', async () => {
      const read = await networkPath.readPath(chain(), '9.9.9.9:16127', addressesOf);

      expect(read.verified).to.equal(true);
      expect(read.hops.map((h) => [h.pubKey, h.sentAt, h.to])).to.deep.equal([
        [a.pubKey, 1100, b.address], [b.pubKey, 1300, '9.9.9.9:16127'],
      ]);
    });

    it('does not verify a path with a hop edited', async () => {
      const edited = chain();
      edited.networkPath[0][0] += 1;

      expect((await networkPath.readPath(edited, '9.9.9.9:16127', addressesOf)).verified).to.equal(false);
    });

    it('does not verify a path with a hop removed', async () => {
      const cut = chain();
      cut.networkPath.shift();

      expect((await networkPath.readPath(cut, '9.9.9.9:16127', addressesOf)).verified).to.equal(false);
    });

    it('does not verify a path that reached another node', async () => {
      expect((await networkPath.readPath(chain(), '8.8.8.8:16127', addressesOf)).verified).to.equal(false);
    });
  });

  it('stops adding hops at the cap and sends the path as it stands', () => {
    const path = Array.from({ length: networkPath.MAX_HOPS }, (_, i) => [i, `${'A'.repeat(87)}=`]);
    const framed = JSON.parse(networkPath.framed({ ...message(), networkPath: path }, signerOf(key()), '1.1.1.1:16127', 1250));

    expect(framed.networkPath).to.deep.equal(path);
  });

  it('starts again from a path that is not one', () => {
    [
      'x', 7, [['a', 'b']], [[1, 'short']], [[1]],
      Array.from({ length: networkPath.MAX_HOPS + 1 }, () => [1, `${'A'.repeat(87)}=`]),
    ].forEach((bad) => {
      expect(networkPath.validPath(bad), JSON.stringify(bad).slice(0, 40)).to.deep.equal([]);
    });
  });

  it('sends the message unextended when the node cannot sign', () => {
    const framed = JSON.parse(networkPath.framed(message(), () => null, '1.1.1.1:16127', 1250));

    expect(framed.networkPath).to.deep.equal([]);
  });
});
