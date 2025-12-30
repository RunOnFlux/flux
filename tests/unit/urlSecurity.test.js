const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
const { expect } = chai;
const {
  validateUrl,
  validateUrlWithDns,
  isUrlSafe,
  isBlockedIP,
  isBlockedHostname,
  normalizeIpString,
  ipv6MappedToIpv4,
} = require('../../ZelBack/src/services/utils/urlSecurity');

describe('urlSecurity', () => {
  describe('validateUrl', () => {
    it('should allow valid external HTTPS URLs', () => {
      expect(validateUrl('https://example.com/file.tar.gz')).to.equal('https://example.com/file.tar.gz');
      expect(validateUrl('https://cdn.example.org/backup.zip')).to.equal('https://cdn.example.org/backup.zip');
    });

    it('should allow valid external HTTP URLs', () => {
      expect(validateUrl('http://example.com/file.tar.gz')).to.equal('http://example.com/file.tar.gz');
    });

    it('should block localhost', () => {
      expect(() => validateUrl('http://localhost/admin')).to.throw('hostname is not allowed');
      expect(() => validateUrl('http://localhost:8080/api')).to.throw('hostname is not allowed');
      expect(() => validateUrl('https://localhost/secret')).to.throw('hostname is not allowed');
    });

    it('should block loopback IP addresses', () => {
      expect(() => validateUrl('http://127.0.0.1/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://127.0.0.1:16127/flux/version')).to.throw('private/internal IP');
      expect(() => validateUrl('http://127.0.1.1/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://127.255.255.255/')).to.throw('private/internal IP');
    });

    it('should block private Class A addresses (10.x.x.x)', () => {
      expect(() => validateUrl('http://10.0.0.1/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://10.255.255.255/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://10.10.10.10:8080/api')).to.throw('private/internal IP');
    });

    it('should block private Class B addresses (172.16-31.x.x)', () => {
      expect(() => validateUrl('http://172.16.0.1/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://172.31.255.255/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://172.20.10.5/')).to.throw('private/internal IP');
    });

    it('should allow non-private 172.x.x.x addresses', () => {
      // 172.15.x.x and 172.32.x.x are not private
      expect(validateUrl('http://172.15.0.1/')).to.equal('http://172.15.0.1/');
      expect(validateUrl('http://172.32.0.1/')).to.equal('http://172.32.0.1/');
    });

    it('should block private Class C addresses (192.168.x.x)', () => {
      expect(() => validateUrl('http://192.168.0.1/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://192.168.1.1/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://192.168.255.255/')).to.throw('private/internal IP');
    });

    it('should block link-local/metadata addresses (169.254.x.x)', () => {
      expect(() => validateUrl('http://169.254.169.254/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://169.254.169.254/latest/meta-data/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://169.254.0.1/')).to.throw('private/internal IP');
    });

    it('should block cloud metadata hostnames', () => {
      expect(() => validateUrl('http://metadata.google.internal/')).to.throw('hostname is not allowed');
      expect(() => validateUrl('http://metadata.goog/')).to.throw('hostname is not allowed');
    });

    it('should block kubernetes internal hostnames', () => {
      expect(() => validateUrl('http://kubernetes.default/')).to.throw('hostname is not allowed');
      expect(() => validateUrl('http://kubernetes.default.svc/')).to.throw('hostname is not allowed');
      expect(() => validateUrl('http://kubernetes.default.svc.cluster.local/')).to.throw('hostname is not allowed');
    });

    it('should block non-HTTP protocols', () => {
      expect(() => validateUrl('file:///etc/passwd')).to.throw('Protocol');
      expect(() => validateUrl('ftp://example.com/file')).to.throw('Protocol');
      expect(() => validateUrl('gopher://evil.com/')).to.throw('Protocol');
      expect(() => validateUrl('data:text/html,<script>alert(1)</script>')).to.throw('Protocol');
    });

    it('should block IPv6 loopback', () => {
      expect(() => validateUrl('http://[::1]/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://[::1]:8080/')).to.throw('private/internal IP');
    });

    it('should block IPv6 link-local', () => {
      expect(() => validateUrl('http://[fe80::1]/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://[fe80::1234:5678]/')).to.throw('private/internal IP');
    });

    it('should block IPv6 unique local addresses', () => {
      expect(() => validateUrl('http://[fc00::1]/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://[fd00::1]/')).to.throw('private/internal IP');
      expect(() => validateUrl('http://[fd12:3456:789a::1]/')).to.throw('private/internal IP');
    });

    it('should throw for invalid URL format', () => {
      expect(() => validateUrl('not-a-url')).to.throw('Invalid URL');
      expect(() => validateUrl('')).to.throw('non-empty string');
      expect(() => validateUrl(null)).to.throw('non-empty string');
      expect(() => validateUrl(undefined)).to.throw('non-empty string');
    });

    it('should allow private IPs when allowPrivate option is true', () => {
      const options = { allowPrivate: true };
      expect(validateUrl('http://127.0.0.1/', options)).to.equal('http://127.0.0.1/');
      expect(validateUrl('http://10.0.0.1/', options)).to.equal('http://10.0.0.1/');
      expect(validateUrl('http://192.168.1.1/', options)).to.equal('http://192.168.1.1/');
    });

    it('should respect allowedHosts option', () => {
      const options = { allowedHosts: ['trusted.com', 'cdn.trusted.org'] };
      expect(validateUrl('https://trusted.com/file', options)).to.equal('https://trusted.com/file');
      expect(validateUrl('https://cdn.trusted.org/file', options)).to.equal('https://cdn.trusted.org/file');
      expect(validateUrl('https://sub.trusted.com/file', options)).to.equal('https://sub.trusted.com/file');
      expect(() => validateUrl('https://evil.com/file', options)).to.throw('not in the allowed list');
    });

    it('should normalize URLs', () => {
      // URL constructor normalizes the URL
      expect(validateUrl('https://EXAMPLE.COM/path')).to.equal('https://example.com/path');
    });
  });

  describe('isBlockedIP', () => {
    it('should return true for loopback addresses', () => {
      expect(isBlockedIP('127.0.0.1')).to.be.true;
      expect(isBlockedIP('127.0.0.2')).to.be.true;
      expect(isBlockedIP('127.255.255.255')).to.be.true;
    });

    it('should return true for private addresses', () => {
      expect(isBlockedIP('10.0.0.1')).to.be.true;
      expect(isBlockedIP('172.16.0.1')).to.be.true;
      expect(isBlockedIP('192.168.1.1')).to.be.true;
    });

    it('should return true for link-local addresses', () => {
      expect(isBlockedIP('169.254.169.254')).to.be.true;
      expect(isBlockedIP('169.254.0.1')).to.be.true;
    });

    it('should return false for public addresses', () => {
      expect(isBlockedIP('8.8.8.8')).to.be.false;
      expect(isBlockedIP('1.1.1.1')).to.be.false;
      expect(isBlockedIP('93.184.216.34')).to.be.false;
    });

    it('should return true for IPv6 loopback', () => {
      expect(isBlockedIP('::1')).to.be.true;
    });

    it('should return true for null/undefined', () => {
      expect(isBlockedIP(null)).to.be.true;
      expect(isBlockedIP(undefined)).to.be.true;
      expect(isBlockedIP('')).to.be.true;
    });
  });

  describe('isBlockedHostname', () => {
    it('should return true for localhost', () => {
      expect(isBlockedHostname('localhost')).to.be.true;
      expect(isBlockedHostname('LOCALHOST')).to.be.true;
      expect(isBlockedHostname('localhost.localdomain')).to.be.true;
    });

    it('should return true for cloud metadata hostnames', () => {
      expect(isBlockedHostname('metadata.google.internal')).to.be.true;
      expect(isBlockedHostname('metadata.goog')).to.be.true;
    });

    it('should return true for subdomains of blocked hostnames', () => {
      expect(isBlockedHostname('sub.localhost')).to.be.true;
      expect(isBlockedHostname('api.metadata.google.internal')).to.be.true;
    });

    it('should return false for normal hostnames', () => {
      expect(isBlockedHostname('example.com')).to.be.false;
      expect(isBlockedHostname('google.com')).to.be.false;
      expect(isBlockedHostname('cdn.example.org')).to.be.false;
    });

    it('should return true for null/undefined', () => {
      expect(isBlockedHostname(null)).to.be.true;
      expect(isBlockedHostname(undefined)).to.be.true;
      expect(isBlockedHostname('')).to.be.true;
    });
  });

  describe('isUrlSafe', () => {
    it('should return true for safe URLs', () => {
      expect(isUrlSafe('https://example.com/file')).to.be.true;
      expect(isUrlSafe('http://cdn.example.org/backup.zip')).to.be.true;
    });

    it('should return false for unsafe URLs', () => {
      expect(isUrlSafe('http://127.0.0.1/')).to.be.false;
      expect(isUrlSafe('http://localhost/')).to.be.false;
      expect(isUrlSafe('http://169.254.169.254/')).to.be.false;
      expect(isUrlSafe('file:///etc/passwd')).to.be.false;
      expect(isUrlSafe('not-a-url')).to.be.false;
    });
  });

  describe('validateUrlWithDns', () => {
    it('should validate URLs that resolve to public IPs', async () => {
      // This test relies on example.com resolving to a public IP
      const result = await validateUrlWithDns('https://example.com/');
      expect(result).to.equal('https://example.com/');
    });

    it('should throw for non-existent hostnames', async () => {
      await expect(
        validateUrlWithDns('https://this-domain-definitely-does-not-exist-12345.com/'),
      ).to.be.rejectedWith('could not be resolved');
    });

    it('should still block localhost via basic validation', async () => {
      await expect(
        validateUrlWithDns('http://localhost/'),
      ).to.be.rejectedWith('hostname is not allowed');
    });

    it('should still block private IPs via basic validation', async () => {
      await expect(
        validateUrlWithDns('http://127.0.0.1/'),
      ).to.be.rejectedWith('private/internal IP');
    });
  });

  describe('normalizeIpString', () => {
    it('should strip brackets from IPv6 addresses', () => {
      expect(normalizeIpString('[::1]')).to.equal('::1');
      expect(normalizeIpString('[fe80::1]')).to.equal('fe80::1');
      expect(normalizeIpString('[::ffff:127.0.0.1]')).to.equal('::ffff:127.0.0.1');
    });

    it('should remove zone identifiers', () => {
      expect(normalizeIpString('fe80::1%eth0')).to.equal('fe80::1');
      expect(normalizeIpString('fe80::1234%en0')).to.equal('fe80::1234');
    });

    it('should handle both brackets and zone identifiers', () => {
      expect(normalizeIpString('[fe80::1%eth0]')).to.equal('fe80::1');
    });

    it('should return IPv4 addresses unchanged', () => {
      expect(normalizeIpString('127.0.0.1')).to.equal('127.0.0.1');
      expect(normalizeIpString('10.0.0.1')).to.equal('10.0.0.1');
    });

    it('should handle null/undefined gracefully', () => {
      expect(normalizeIpString(null)).to.equal(null);
      expect(normalizeIpString(undefined)).to.equal(undefined);
      expect(normalizeIpString('')).to.equal('');
    });
  });

  describe('ipv6MappedToIpv4', () => {
    it('should extract IPv4 from dotted-decimal mapped addresses', () => {
      expect(ipv6MappedToIpv4('::ffff:127.0.0.1')).to.equal('127.0.0.1');
      expect(ipv6MappedToIpv4('::ffff:10.0.0.1')).to.equal('10.0.0.1');
      expect(ipv6MappedToIpv4('::ffff:192.168.1.1')).to.equal('192.168.1.1');
      expect(ipv6MappedToIpv4('::ffff:169.254.169.254')).to.equal('169.254.169.254');
    });

    it('should extract IPv4 from hex-encoded mapped addresses', () => {
      // ::ffff:7f00:1 = 127.0.0.1
      expect(ipv6MappedToIpv4('::ffff:7f00:1')).to.equal('127.0.0.1');
      // ::ffff:0a00:1 = 10.0.0.1
      expect(ipv6MappedToIpv4('::ffff:a00:1')).to.equal('10.0.0.1');
      // ::ffff:c0a8:101 = 192.168.1.1
      expect(ipv6MappedToIpv4('::ffff:c0a8:101')).to.equal('192.168.1.1');
    });

    it('should be case-insensitive', () => {
      expect(ipv6MappedToIpv4('::FFFF:127.0.0.1')).to.equal('127.0.0.1');
      expect(ipv6MappedToIpv4('::FFFF:7F00:1')).to.equal('127.0.0.1');
    });

    it('should return null for non-mapped addresses', () => {
      expect(ipv6MappedToIpv4('::1')).to.be.null;
      expect(ipv6MappedToIpv4('fe80::1')).to.be.null;
      expect(ipv6MappedToIpv4('127.0.0.1')).to.be.null;
      expect(ipv6MappedToIpv4('fc00::1')).to.be.null;
    });

    it('should return null for null/undefined', () => {
      expect(ipv6MappedToIpv4(null)).to.be.null;
      expect(ipv6MappedToIpv4(undefined)).to.be.null;
      expect(ipv6MappedToIpv4('')).to.be.null;
    });
  });

  describe('IPv6-mapped IPv4 blocking', () => {
    describe('isBlockedIP', () => {
      it('should block IPv6-mapped loopback addresses', () => {
        expect(isBlockedIP('::ffff:127.0.0.1')).to.be.true;
        expect(isBlockedIP('::ffff:7f00:1')).to.be.true;
        expect(isBlockedIP('[::ffff:127.0.0.1]')).to.be.true;
      });

      it('should block IPv6-mapped private addresses', () => {
        expect(isBlockedIP('::ffff:10.0.0.1')).to.be.true;
        expect(isBlockedIP('::ffff:172.16.0.1')).to.be.true;
        expect(isBlockedIP('::ffff:192.168.1.1')).to.be.true;
        expect(isBlockedIP('::ffff:c0a8:101')).to.be.true; // 192.168.1.1 in hex
      });

      it('should block IPv6-mapped link-local addresses', () => {
        expect(isBlockedIP('::ffff:169.254.169.254')).to.be.true;
        expect(isBlockedIP('::ffff:a9fe:a9fe')).to.be.true; // 169.254.169.254 in hex
      });

      it('should allow IPv6-mapped public addresses', () => {
        expect(isBlockedIP('::ffff:8.8.8.8')).to.be.false;
        expect(isBlockedIP('::ffff:1.1.1.1')).to.be.false;
        expect(isBlockedIP('::ffff:808:808')).to.be.false; // 8.8.8.8 in hex
      });
    });

    describe('validateUrl', () => {
      it('should block URLs with IPv6-mapped loopback', () => {
        expect(() => validateUrl('http://[::ffff:127.0.0.1]/')).to.throw('private/internal IP');
        expect(() => validateUrl('http://[::ffff:127.0.0.1]:8080/')).to.throw('private/internal IP');
      });

      it('should block URLs with IPv6-mapped private addresses', () => {
        expect(() => validateUrl('http://[::ffff:10.0.0.1]/')).to.throw('private/internal IP');
        expect(() => validateUrl('http://[::ffff:192.168.1.1]/')).to.throw('private/internal IP');
        expect(() => validateUrl('http://[::ffff:172.16.0.1]/')).to.throw('private/internal IP');
      });

      it('should block URLs with IPv6-mapped metadata addresses', () => {
        expect(() => validateUrl('http://[::ffff:169.254.169.254]/')).to.throw('private/internal IP');
      });
    });
  });
});
