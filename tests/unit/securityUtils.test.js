const { expect } = require('chai');

// Import security utility functions
const { isPrivateIP, validateUrl } = require('../../ZelBack/src/services/IOUtils');

describe('Security Utils - SSRF Protection (SEC-03)', () => {
  describe('isPrivateIP', () => {
    describe('Private IPv4 addresses (should return true)', () => {
      it('should detect loopback addresses', () => {
        expect(isPrivateIP('127.0.0.1')).to.be.true;
        expect(isPrivateIP('127.0.0.255')).to.be.true;
        expect(isPrivateIP('127.255.255.255')).to.be.true;
      });

      it('should detect Class A private range (10.x.x.x)', () => {
        expect(isPrivateIP('10.0.0.1')).to.be.true;
        expect(isPrivateIP('10.255.255.255')).to.be.true;
      });

      it('should detect Class B private range (172.16-31.x.x)', () => {
        expect(isPrivateIP('172.16.0.1')).to.be.true;
        expect(isPrivateIP('172.31.255.255')).to.be.true;
      });

      it('should detect Class C private range (192.168.x.x)', () => {
        expect(isPrivateIP('192.168.0.1')).to.be.true;
        expect(isPrivateIP('192.168.255.255')).to.be.true;
      });

      it('should detect link-local addresses (169.254.x.x)', () => {
        expect(isPrivateIP('169.254.0.1')).to.be.true;
        expect(isPrivateIP('169.254.169.254')).to.be.true; // AWS metadata
      });

      it('should detect multicast addresses (224.x.x.x)', () => {
        expect(isPrivateIP('224.0.0.1')).to.be.true;
      });

      it('should detect broadcast address', () => {
        expect(isPrivateIP('255.255.255.255')).to.be.true;
      });
    });

    describe('Public IPv4 addresses (should return false)', () => {
      it('should allow common public IPs', () => {
        expect(isPrivateIP('8.8.8.8')).to.be.false; // Google DNS
        expect(isPrivateIP('1.1.1.1')).to.be.false; // Cloudflare DNS
        expect(isPrivateIP('208.67.222.222')).to.be.false; // OpenDNS
      });

      it('should not flag 172.15.x.x as private (outside Class B range)', () => {
        expect(isPrivateIP('172.15.0.1')).to.be.false;
      });

      it('should not flag 172.32.x.x as private (outside Class B range)', () => {
        expect(isPrivateIP('172.32.0.1')).to.be.false;
      });
    });

    describe('IPv6 addresses', () => {
      it('should detect IPv6 loopback', () => {
        expect(isPrivateIP('::1')).to.be.true;
      });

      it('should detect IPv6 link-local', () => {
        expect(isPrivateIP('fe80::')).to.be.true;
        expect(isPrivateIP('fe80::1')).to.be.true;
      });

      it('should detect IPv6 unique local addresses', () => {
        expect(isPrivateIP('fc00::1')).to.be.true;
        expect(isPrivateIP('fd00::1')).to.be.true;
      });
    });
  });

  describe('validateUrl', () => {
    describe('Valid URLs (should pass)', () => {
      it('should allow HTTPS URLs to public domains', async () => {
        const result = await validateUrl('https://example.com/file.tar.gz');
        expect(result.valid).to.be.true;
      });

      it('should allow HTTP URLs when allowHttp is true', async () => {
        const result = await validateUrl('http://example.com/file.tar.gz', { allowHttp: true });
        expect(result.valid).to.be.true;
      });
    });

    describe('Invalid URLs (should be blocked)', () => {
      it('should block HTTP URLs by default', async () => {
        const result = await validateUrl('http://example.com/file.tar.gz');
        expect(result.valid).to.be.false;
        expect(result.error).to.include('HTTP protocol not allowed');
      });

      it('should block localhost', async () => {
        const result = await validateUrl('https://localhost/file.tar.gz');
        expect(result.valid).to.be.false;
        expect(result.error).to.include('Blocked hostname');
      });

      it('should block AWS metadata endpoint IP', async () => {
        const result = await validateUrl('http://169.254.169.254/latest/meta-data/', { allowHttp: true });
        expect(result.valid).to.be.false;
      });

      it('should block private IP addresses', async () => {
        const result = await validateUrl('http://192.168.1.1/file', { allowHttp: true });
        expect(result.valid).to.be.false;
        expect(result.error).to.include('Private/reserved IP');
      });

      it('should block loopback IP addresses', async () => {
        const result = await validateUrl('http://127.0.0.1/file', { allowHttp: true });
        expect(result.valid).to.be.false;
        expect(result.error).to.include('Private/reserved IP');
      });

      it('should block file:// protocol', async () => {
        const result = await validateUrl('file:///etc/passwd');
        expect(result.valid).to.be.false;
        expect(result.error).to.include('Invalid protocol');
      });

      it('should block invalid URLs', async () => {
        const result = await validateUrl('not-a-valid-url');
        expect(result.valid).to.be.false;
        expect(result.error).to.include('Invalid URL');
      });

      it('should block Google Cloud metadata endpoint', async () => {
        const result = await validateUrl('http://metadata.google.internal/computeMetadata/v1/', { allowHttp: true });
        expect(result.valid).to.be.false;
        expect(result.error).to.include('Blocked hostname');
      });
    });
  });
});
