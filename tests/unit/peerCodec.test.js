const { expect } = require('chai');

const {
  MSG_TYPE,
  NAK_REASON,
  writePeer,
  readPeer,
  encodeHashPresent,
  decodeHashPresent,
  encodeHashRequest,
  decodeHashRequest,
  encodeNak,
  decodeNak,
  encodePeerExchange,
  decodePeerExchange,
  encodePeerUpdate,
  decodePeerUpdate,
} = require('../../ZelBack/src/services/utils/peerCodec');

describe('peerCodec', () => {
  describe('writePeer / readPeer', () => {
    it('should round-trip a standard ip:port', () => {
      const buf = Buffer.alloc(6);
      writePeer(buf, 0, '192.168.1.100:16127');
      expect(readPeer(buf, 0)).to.equal('192.168.1.100:16127');
    });

    it('should handle 0.0.0.0:0', () => {
      const buf = Buffer.alloc(6);
      writePeer(buf, 0, '0.0.0.0:0');
      expect(readPeer(buf, 0)).to.equal('0.0.0.0:0');
    });

    it('should handle 255.255.255.255:65535', () => {
      const buf = Buffer.alloc(6);
      writePeer(buf, 0, '255.255.255.255:65535');
      expect(readPeer(buf, 0)).to.equal('255.255.255.255:65535');
    });

    it('should write at arbitrary offset', () => {
      const buf = Buffer.alloc(12);
      writePeer(buf, 6, '10.0.0.1:16147');
      expect(readPeer(buf, 6)).to.equal('10.0.0.1:16147');
    });
  });

  describe('encodeHashPresent / decodeHashPresent', () => {
    it('should round-trip a 40-char hex hash', () => {
      const hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
      const buf = encodeHashPresent(hash);
      expect(buf.length).to.equal(21);
      expect(buf[0]).to.equal(MSG_TYPE.HASH_PRESENT);
      const decoded = decodeHashPresent(buf);
      expect(decoded.hash).to.equal(hash);
    });

    it('should produce exactly 21 bytes', () => {
      const hash = '0000000000000000000000000000000000000000';
      const buf = encodeHashPresent(hash);
      expect(buf.length).to.equal(21);
    });
  });

  describe('encodeHashRequest / decodeHashRequest', () => {
    it('should round-trip a 40-char hex hash', () => {
      const hash = 'ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00';
      const buf = encodeHashRequest(hash);
      expect(buf.length).to.equal(21);
      expect(buf[0]).to.equal(MSG_TYPE.HASH_REQUEST);
      const decoded = decodeHashRequest(buf);
      expect(decoded.hash).to.equal(hash);
    });
  });

  describe('encodeNak / decodeNak', () => {
    it('should round-trip with STALE reason', () => {
      const hash = 'abcdef0123456789abcdef0123456789abcdef01';
      const buf = encodeNak(hash, NAK_REASON.STALE);
      expect(buf.length).to.equal(22);
      expect(buf[0]).to.equal(MSG_TYPE.NAK);
      const decoded = decodeNak(buf);
      expect(decoded.hash).to.equal(hash);
      expect(decoded.reason).to.equal(NAK_REASON.STALE);
    });

    it('should round-trip with DUPLICATE reason', () => {
      const hash = '1111111111111111111111111111111111111111';
      const buf = encodeNak(hash, NAK_REASON.DUPLICATE);
      const decoded = decodeNak(buf);
      expect(decoded.reason).to.equal(NAK_REASON.DUPLICATE);
    });

    it('should round-trip with INVALID reason', () => {
      const hash = '2222222222222222222222222222222222222222';
      const buf = encodeNak(hash, NAK_REASON.INVALID);
      const decoded = decodeNak(buf);
      expect(decoded.reason).to.equal(NAK_REASON.INVALID);
    });
  });

  describe('encodePeerExchange / decodePeerExchange', () => {
    it('should round-trip empty lists', () => {
      const buf = encodePeerExchange([], []);
      expect(buf.length).to.equal(5);
      expect(buf[0]).to.equal(MSG_TYPE.PEER_EXCHANGE);
      const decoded = decodePeerExchange(buf);
      expect(decoded.outbound).to.deep.equal([]);
      expect(decoded.inbound).to.deep.equal([]);
    });

    it('should round-trip outbound only', () => {
      const out = ['10.0.0.1:16127', '10.0.0.2:16137'];
      const buf = encodePeerExchange(out, []);
      expect(buf.length).to.equal(5 + 2 * 6);
      const decoded = decodePeerExchange(buf);
      expect(decoded.outbound).to.deep.equal(out);
      expect(decoded.inbound).to.deep.equal([]);
    });

    it('should round-trip inbound only', () => {
      const inb = ['192.168.1.1:16127'];
      const buf = encodePeerExchange([], inb);
      expect(buf.length).to.equal(5 + 1 * 6);
      const decoded = decodePeerExchange(buf);
      expect(decoded.outbound).to.deep.equal([]);
      expect(decoded.inbound).to.deep.equal(inb);
    });

    it('should round-trip both directions', () => {
      const out = ['10.0.0.1:16127', '10.0.0.2:16137'];
      const inb = ['192.168.1.1:16127', '8.8.8.8:16167'];
      const buf = encodePeerExchange(out, inb);
      expect(buf.length).to.equal(5 + 4 * 6);
      const decoded = decodePeerExchange(buf);
      expect(decoded.outbound).to.deep.equal(out);
      expect(decoded.inbound).to.deep.equal(inb);
    });

    it('should handle max peers (60 each direction)', () => {
      const out = [];
      const inb = [];
      for (let i = 0; i < 30; i++) {
        out.push(`${i}.${i % 256}.${(i * 3) % 256}.${(i * 7) % 256}:${16127 + i}`);
        inb.push(`${i + 100}.${i % 256}.${(i * 5) % 256}.${(i * 11) % 256}:${16127 + i}`);
      }
      const buf = encodePeerExchange(out, inb);
      expect(buf.length).to.equal(5 + 60 * 6);
      const decoded = decodePeerExchange(buf);
      expect(decoded.outbound).to.deep.equal(out);
      expect(decoded.inbound).to.deep.equal(inb);
    });
  });

  describe('encodePeerUpdate / decodePeerUpdate', () => {
    it('should round-trip adds only', () => {
      const add = ['1.2.3.4:16127', '5.6.7.8:16137'];
      const buf = encodePeerUpdate(add, []);
      expect(buf[0]).to.equal(MSG_TYPE.PEER_UPDATE);
      expect(buf.length).to.equal(5 + 2 * 6);
      const decoded = decodePeerUpdate(buf);
      expect(decoded.add).to.deep.equal(add);
      expect(decoded.rm).to.deep.equal([]);
    });

    it('should round-trip removes only', () => {
      const rm = ['9.10.11.12:16127'];
      const buf = encodePeerUpdate([], rm);
      expect(buf.length).to.equal(5 + 1 * 6);
      const decoded = decodePeerUpdate(buf);
      expect(decoded.add).to.deep.equal([]);
      expect(decoded.rm).to.deep.equal(rm);
    });

    it('should round-trip both adds and removes', () => {
      const add = ['1.1.1.1:16127'];
      const rm = ['2.2.2.2:16127', '3.3.3.3:16137'];
      const buf = encodePeerUpdate(add, rm);
      expect(buf.length).to.equal(5 + 3 * 6);
      const decoded = decodePeerUpdate(buf);
      expect(decoded.add).to.deep.equal(add);
      expect(decoded.rm).to.deep.equal(rm);
    });

    it('should round-trip empty update', () => {
      const buf = encodePeerUpdate([], []);
      expect(buf.length).to.equal(5);
      const decoded = decodePeerUpdate(buf);
      expect(decoded.add).to.deep.equal([]);
      expect(decoded.rm).to.deep.equal([]);
    });
  });
});
