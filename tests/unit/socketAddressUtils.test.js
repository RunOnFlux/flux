const { expect } = require('chai');
const {
  DEFAULT_API_PORT,
  normalizeSocketAddress,
  extractIp,
  extractPort,
  parseSocketAddress,
  socketAddressesMatch,
  ipsMatch,
} = require('../../ZelBack/src/services/utils/socketAddressUtils');

describe('socketAddressUtils tests', () => {
  describe('DEFAULT_API_PORT', () => {
    it('should be 16127', () => {
      expect(DEFAULT_API_PORT).to.equal(16127);
    });
  });

  describe('normalizeSocketAddress', () => {
    it('should return null for null', () => {
      expect(normalizeSocketAddress(null)).to.be.null;
    });

    it('should return null for undefined', () => {
      expect(normalizeSocketAddress(undefined)).to.be.null;
    });

    it('should return null for empty string', () => {
      expect(normalizeSocketAddress('')).to.be.null;
    });

    it('should append default port to bare IP', () => {
      expect(normalizeSocketAddress('1.2.3.4')).to.equal('1.2.3.4:16127');
    });

    it('should return ip:port as-is when default port present', () => {
      expect(normalizeSocketAddress('1.2.3.4:16127')).to.equal('1.2.3.4:16127');
    });

    it('should preserve non-default port', () => {
      expect(normalizeSocketAddress('1.2.3.4:16137')).to.equal('1.2.3.4:16137');
    });
  });

  describe('extractIp', () => {
    it('should return null for null', () => {
      expect(extractIp(null)).to.be.null;
    });

    it('should return null for undefined', () => {
      expect(extractIp(undefined)).to.be.null;
    });

    it('should return bare IP as-is', () => {
      expect(extractIp('1.2.3.4')).to.equal('1.2.3.4');
    });

    it('should strip default port', () => {
      expect(extractIp('1.2.3.4:16127')).to.equal('1.2.3.4');
    });

    it('should strip non-default port', () => {
      expect(extractIp('1.2.3.4:16137')).to.equal('1.2.3.4');
    });
  });

  describe('extractPort', () => {
    it('should return default port for null', () => {
      expect(extractPort(null)).to.equal(16127);
    });

    it('should return default port for undefined', () => {
      expect(extractPort(undefined)).to.equal(16127);
    });

    it('should return default port for bare IP', () => {
      expect(extractPort('1.2.3.4')).to.equal(16127);
    });

    it('should return default port when explicitly present', () => {
      expect(extractPort('1.2.3.4:16127')).to.equal(16127);
    });

    it('should return non-default port', () => {
      expect(extractPort('1.2.3.4:16137')).to.equal(16137);
    });

    it('should return port as a number', () => {
      const port = extractPort('1.2.3.4:16137');
      expect(port).to.be.a('number');
    });

    it('should return default port for trailing colon', () => {
      expect(extractPort('1.2.3.4:')).to.equal(16127);
    });

    it('should return default port for non-numeric port', () => {
      expect(extractPort('1.2.3.4:abc')).to.equal(16127);
    });
  });

  describe('parseSocketAddress', () => {
    it('should return null for null', () => {
      expect(parseSocketAddress(null)).to.be.null;
    });

    it('should return null for undefined', () => {
      expect(parseSocketAddress(undefined)).to.be.null;
    });

    it('should return null for non-string', () => {
      expect(parseSocketAddress(12345)).to.be.null;
    });

    it('should return null for invalid IP', () => {
      expect(parseSocketAddress('999.999.999.999')).to.be.null;
    });

    it('should return null for non-numeric port', () => {
      expect(parseSocketAddress('1.2.3.4:abc')).to.be.null;
    });

    it('should return null for port out of range', () => {
      expect(parseSocketAddress('1.2.3.4:70000')).to.be.null;
    });

    it('should return null for port 0', () => {
      expect(parseSocketAddress('1.2.3.4:0')).to.be.null;
    });

    it('should reject hex port', () => {
      expect(parseSocketAddress('1.2.3.4:0x3F7F')).to.be.null;
    });

    it('should reject trailing garbage after port', () => {
      expect(parseSocketAddress('1.2.3.4:16127:foo')).to.be.null;
    });

    it('should reject leading zero port', () => {
      expect(parseSocketAddress('1.2.3.4:016127')).to.be.null;
    });

    it('should accept port 65535', () => {
      const result = parseSocketAddress('1.2.3.4:65535');
      expect(result).to.deep.equal({ ip: '1.2.3.4', port: 65535 });
    });

    it('should reject port 65536', () => {
      expect(parseSocketAddress('1.2.3.4:65536')).to.be.null;
    });

    it('should parse bare IP with default port', () => {
      const result = parseSocketAddress('1.2.3.4');
      expect(result).to.deep.equal({ ip: '1.2.3.4', port: 16127 });
    });

    it('should parse ip:port', () => {
      const result = parseSocketAddress('85.159.213.248:16147');
      expect(result).to.deep.equal({ ip: '85.159.213.248', port: 16147 });
    });

    it('should return port as a number', () => {
      const result = parseSocketAddress('1.2.3.4:16127');
      expect(result.port).to.be.a('number');
    });
  });

  describe('socketAddressesMatch', () => {
    it('should match bare IP vs same IP with default port', () => {
      expect(socketAddressesMatch('1.2.3.4', '1.2.3.4:16127')).to.be.true;
    });

    it('should match ip:port vs bare IP (reversed)', () => {
      expect(socketAddressesMatch('1.2.3.4:16127', '1.2.3.4')).to.be.true;
    });

    it('should match identical ip:port', () => {
      expect(socketAddressesMatch('1.2.3.4:16127', '1.2.3.4:16127')).to.be.true;
    });

    it('should match identical bare IPs', () => {
      expect(socketAddressesMatch('1.2.3.4', '1.2.3.4')).to.be.true;
    });

    it('should not match different ports', () => {
      expect(socketAddressesMatch('1.2.3.4:16137', '1.2.3.4:16127')).to.be.false;
    });

    it('should not match non-default port vs bare IP (implicit default)', () => {
      expect(socketAddressesMatch('1.2.3.4:16137', '1.2.3.4')).to.be.false;
    });

    it('should return false for null vs address', () => {
      expect(socketAddressesMatch(null, '1.2.3.4')).to.be.false;
    });

    it('should return false for null vs null', () => {
      expect(socketAddressesMatch(null, null)).to.be.false;
    });

    it('should return false for undefined vs address', () => {
      expect(socketAddressesMatch(undefined, '1.2.3.4')).to.be.false;
    });

    it('should not match different IPs', () => {
      expect(socketAddressesMatch('1.2.3.4', '5.6.7.8')).to.be.false;
    });

    it('should not match different IPs with same port', () => {
      expect(socketAddressesMatch('1.2.3.4:16127', '5.6.7.8:16127')).to.be.false;
    });
  });

  describe('ipsMatch', () => {
    it('should match a bare IP against a non-default-port socket on the same IP', () => {
      // The core case: FDM returns a bare IP, the node is on a UPnP port.
      expect(ipsMatch('1.2.3.4', '1.2.3.4:16157')).to.be.true;
      expect(ipsMatch('1.2.3.4:16157', '1.2.3.4')).to.be.true;
    });

    it('should match a bare IP against a default-port socket on the same IP', () => {
      expect(ipsMatch('1.2.3.4', '1.2.3.4:16127')).to.be.true;
    });

    it('should match two bare IPs that are equal', () => {
      expect(ipsMatch('1.2.3.4', '1.2.3.4')).to.be.true;
    });

    it('should match sockets on the same IP with different ports', () => {
      // Unlike socketAddressesMatch, the port is ignored entirely.
      expect(ipsMatch('1.2.3.4:16137', '1.2.3.4:16157')).to.be.true;
    });

    it('should not match different IPs regardless of port', () => {
      expect(ipsMatch('1.2.3.4', '5.6.7.8')).to.be.false;
      expect(ipsMatch('1.2.3.4:16157', '5.6.7.8:16157')).to.be.false;
      expect(ipsMatch('1.2.3.4:16157', '5.6.7.8')).to.be.false;
    });

    it('should return false when either argument is missing', () => {
      expect(ipsMatch(null, '1.2.3.4')).to.be.false;
      expect(ipsMatch('1.2.3.4', null)).to.be.false;
      expect(ipsMatch(null, null)).to.be.false;
      expect(ipsMatch(undefined, '1.2.3.4')).to.be.false;
    });
  });
});
