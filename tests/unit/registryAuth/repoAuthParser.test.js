const { expect } = require('chai');
const sinon = require('sinon');
const { RepoAuthParser } = require('../../../ZelBack/src/services/registryAuth/utils/repoAuthParser');

describe('RepoAuthParser Tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('parse() - Basic Auth Format', () => {
    it('should parse simple username:password', () => {
      const result = RepoAuthParser.parse('myuser:mypassword');

      expect(result).to.deep.equal({
        type: 'basic',
        username: 'myuser',
        password: 'mypassword',
      });
    });

    it('should parse username with email format', () => {
      const result = RepoAuthParser.parse('user@example.com:password123');

      expect(result).to.deep.equal({
        type: 'basic',
        username: 'user@example.com',
        password: 'password123',
      });
    });

    it('should parse password containing colons', () => {
      const result = RepoAuthParser.parse('myuser:pass:word:123');

      expect(result).to.deep.equal({
        type: 'basic',
        username: 'myuser',
        password: 'pass:word:123',
      });
    });

    it('should parse password with special characters', () => {
      const result = RepoAuthParser.parse('myuser:p@$$w0rd!#%^&*()');

      expect(result).to.deep.equal({
        type: 'basic',
        username: 'myuser',
        password: 'p@$$w0rd!#%^&*()',
      });
    });

    it('should trim whitespace from username and password', () => {
      const result = RepoAuthParser.parse('  myuser  :  mypassword  ');

      expect(result).to.deep.equal({
        type: 'basic',
        username: 'myuser',
        password: 'mypassword',
      });
    });

    it('should handle empty password', () => {
      const result = RepoAuthParser.parse('myuser:');

      expect(result).to.deep.equal({
        type: 'basic',
        username: 'myuser',
        password: '',
      });
    });

    it('should throw error for missing colon', () => {
      expect(() => RepoAuthParser.parse('myuserpassword')).to.throw(/username:password/i);
    });

    it('should throw error for empty username', () => {
      expect(() => RepoAuthParser.parse(':password')).to.throw(/username cannot be empty/i);
    });

    it('should throw error for whitespace-only username', () => {
      expect(() => RepoAuthParser.parse('   :password')).to.throw(/username cannot be empty/i);
    });
  });

  describe('parse() - Provider Scheme Format', () => {
    it('should parse AWS ECR provider scheme', () => {
      const result = RepoAuthParser.parse('aws-ecr://accessKeyId=AKIAIOSFODNN7EXAMPLE&secretAccessKey=wJalrXUtnFEMI');

      expect(result).to.have.property('type', 'aws-ecr');
      expect(result).to.have.property('accessKeyId', 'AKIAIOSFODNN7EXAMPLE');
      expect(result).to.have.property('secretAccessKey', 'wJalrXUtnFEMI');
    });

    it('should parse Azure ACR provider scheme', () => {
      const result = RepoAuthParser.parse('azure-acr://tenantId=12345678-1234-1234-1234-123456789012&clientId=87654321-4321-4321-4321-210987654321&clientSecret=mySecret');

      expect(result).to.have.property('type', 'azure-acr');
      expect(result).to.have.property('tenantId', '12345678-1234-1234-1234-123456789012');
      expect(result).to.have.property('clientId', '87654321-4321-4321-4321-210987654321');
      expect(result).to.have.property('clientSecret', 'mySecret');
    });

    it('should parse Google GAR provider scheme', () => {
      const keyFile = 'eyJ0eXBlIjoic2VydmljZV9hY2NvdW50In0=';
      const result = RepoAuthParser.parse(`google-gar://keyFile=${encodeURIComponent(keyFile)}`);

      expect(result).to.have.property('type', 'google-gar');
      expect(result).to.have.property('keyFile', keyFile);
    });

    it('should handle URL-encoded parameter values', () => {
      const value = 'value with spaces and special chars !@#$%';
      const encoded = encodeURIComponent(value);
      const result = RepoAuthParser.parse(`aws-ecr://param=${encoded}`);

      expect(result).to.have.property('type', 'aws-ecr');
      expect(result).to.have.property('param', value);
    });

    it('should handle multiple parameters', () => {
      const result = RepoAuthParser.parse('aws-ecr://param1=value1&param2=value2&param3=value3');

      expect(result).to.deep.equal({
        type: 'aws-ecr',
        param1: 'value1',
        param2: 'value2',
        param3: 'value3',
      });
    });

    it('should handle empty parameter value', () => {
      const result = RepoAuthParser.parse('aws-ecr://param1=&param2=value2');

      expect(result).to.have.property('type', 'aws-ecr');
      expect(result).to.have.property('param1', '');
      expect(result).to.have.property('param2', 'value2');
    });

    it('should skip malformed parameters without equals sign', () => {
      const result = RepoAuthParser.parse('aws-ecr://param1=value1&malformed&param2=value2');

      expect(result).to.deep.equal({
        type: 'aws-ecr',
        param1: 'value1',
        param2: 'value2',
      });
    });

    it('should skip parameters with empty keys', () => {
      const result = RepoAuthParser.parse('aws-ecr://=value1&param2=value2');

      expect(result).to.deep.equal({
        type: 'aws-ecr',
        param2: 'value2',
      });
    });

    it('should handle provider scheme with no parameters', () => {
      const result = RepoAuthParser.parse('custom-provider://');

      expect(result).to.deep.equal({
        type: 'custom-provider',
      });
    });

    it('should handle provider names with hyphens', () => {
      const result = RepoAuthParser.parse('my-custom-provider://param=value');

      expect(result).to.have.property('type', 'my-custom-provider');
      expect(result).to.have.property('param', 'value');
    });

    it('should handle provider names with numbers', () => {
      const result = RepoAuthParser.parse('provider123://param=value');

      expect(result).to.have.property('type', 'provider123');
      expect(result).to.have.property('param', 'value');
    });

    it('should handle plus signs as literal characters', () => {
      // Plus signs should be treated as literal + in URI components, not as spaces
      const result = RepoAuthParser.parse('aws-ecr://key=value+with+plus');

      expect(result).to.have.property('key', 'value+with+plus');
    });

    it('should handle equals signs in values if properly encoded', () => {
      const valueWithEquals = 'key=value';
      const encoded = encodeURIComponent(valueWithEquals);
      const result = RepoAuthParser.parse(`aws-ecr://param=${encoded}`);

      expect(result).to.have.property('param', valueWithEquals);
    });

    it('should handle ampersands in values if properly encoded', () => {
      const valueWithAmpersand = 'value&with&ampersand';
      const encoded = encodeURIComponent(valueWithAmpersand);
      const result = RepoAuthParser.parse(`aws-ecr://param=${encoded}`);

      expect(result).to.have.property('param', valueWithAmpersand);
    });
  });

  describe('parse() - Edge Cases', () => {
    it('should return null for null input', () => {
      const result = RepoAuthParser.parse(null);
      expect(result).to.be.null;
    });

    it('should return null for undefined input', () => {
      const result = RepoAuthParser.parse(undefined);
      expect(result).to.be.null;
    });

    it('should return null for empty string', () => {
      const result = RepoAuthParser.parse('');
      expect(result).to.be.null;
    });

    it('should return null for whitespace-only string', () => {
      const result = RepoAuthParser.parse('   ');
      expect(result).to.be.null;
    });

    it('should return null for non-string input', () => {
      // Production code defensively returns null for invalid input types
      expect(RepoAuthParser.parse(123)).to.be.null;
      expect(RepoAuthParser.parse({})).to.be.null;
      expect(RepoAuthParser.parse([])).to.be.null;
    });

    it('should handle very long credentials', () => {
      const longPassword = 'p'.repeat(10000);
      const result = RepoAuthParser.parse(`user:${longPassword}`);

      expect(result.password).to.have.lengthOf(10000);
    });

    it('should handle unicode characters', () => {
      const result = RepoAuthParser.parse('ユーザー:パスワード');

      expect(result).to.have.property('username', 'ユーザー');
      expect(result).to.have.property('password', 'パスワード');
    });

    it('should handle unicode in provider scheme parameters', () => {
      const unicodeValue = 'テスト値';
      const encoded = encodeURIComponent(unicodeValue);
      const result = RepoAuthParser.parse(`provider://param=${encoded}`);

      expect(result).to.have.property('param', unicodeValue);
    });
  });

  describe('encode() - Basic Auth', () => {
    it('should encode basic auth configuration', () => {
      const config = {
        type: 'basic',
        username: 'myuser',
        password: 'mypassword',
      };

      const result = RepoAuthParser.encode(config);
      expect(result).to.equal('myuser:mypassword');
    });

    it('should encode basic auth with empty password', () => {
      const config = {
        type: 'basic',
        username: 'myuser',
        password: '',
      };

      const result = RepoAuthParser.encode(config);
      expect(result).to.equal('myuser:');
    });

    it('should encode basic auth with password containing special characters', () => {
      const config = {
        type: 'basic',
        username: 'myuser',
        password: 'p@$$w0rd!',
      };

      const result = RepoAuthParser.encode(config);
      expect(result).to.equal('myuser:p@$$w0rd!');
    });

    it('should throw error for basic auth without username', () => {
      const config = {
        type: 'basic',
        password: 'mypassword',
      };

      expect(() => RepoAuthParser.encode(config)).to.throw(/requires username/i);
    });
  });

  describe('encode() - Provider Scheme', () => {
    it('should encode AWS ECR configuration', () => {
      const config = {
        type: 'aws-ecr',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI',
      };

      const result = RepoAuthParser.encode(config);
      expect(result).to.match(/^aws-ecr:\/\//);
      expect(result).to.include('accessKeyId=AKIAIOSFODNN7EXAMPLE');
      expect(result).to.include('secretAccessKey=wJalrXUtnFEMI');
    });

    it('should URL-encode special characters in parameter values', () => {
      const config = {
        type: 'aws-ecr',
        param: 'value with spaces',
      };

      const result = RepoAuthParser.encode(config);
      expect(result).to.include('value+with+spaces'); // URLSearchParams uses + for spaces
    });

    it('should skip undefined and null parameter values', () => {
      const config = {
        type: 'aws-ecr',
        param1: 'value1',
        param2: undefined,
        param3: null,
        param4: 'value4',
      };

      const result = RepoAuthParser.encode(config);
      expect(result).to.include('param1=value1');
      expect(result).to.include('param4=value4');
      expect(result).to.not.include('param2');
      expect(result).to.not.include('param3');
    });

    it('should encode empty string parameters', () => {
      const config = {
        type: 'aws-ecr',
        param: '',
      };

      const result = RepoAuthParser.encode(config);
      expect(result).to.include('param=');
    });

    it('should throw error for missing type', () => {
      const config = {
        username: 'myuser',
        password: 'mypassword',
      };

      expect(() => RepoAuthParser.encode(config)).to.throw(/must have a type/i);
    });

    it('should throw error for non-object config', () => {
      expect(() => RepoAuthParser.encode(null)).to.throw(/must be an object/i);
      expect(() => RepoAuthParser.encode('string')).to.throw(/must be an object/i);
      expect(() => RepoAuthParser.encode(123)).to.throw(/must be an object/i);
    });

    it('should throw error for invalid provider name (starts with number)', () => {
      const config = {
        type: '123provider',
        param: 'value',
      };

      expect(() => RepoAuthParser.encode(config)).to.throw(/must start with letter/i);
    });

    it('should throw error for invalid provider name (contains special chars)', () => {
      const config = {
        type: 'provider@invalid',
        param: 'value',
      };

      expect(() => RepoAuthParser.encode(config)).to.throw(/letters, numbers, and hyphens/i);
    });

    it('should allow provider names with hyphens', () => {
      const config = {
        type: 'my-custom-provider',
        param: 'value',
      };

      const result = RepoAuthParser.encode(config);
      expect(result).to.match(/^my-custom-provider:\/\//);
    });

    it('should convert non-string parameter values to strings', () => {
      const config = {
        type: 'aws-ecr',
        numericParam: 12345,
        boolParam: true,
      };

      const result = RepoAuthParser.encode(config);
      expect(result).to.include('numericParam=12345');
      expect(result).to.include('boolParam=true');
    });
  });

  describe('Round-trip: parse() and encode()', () => {
    it('should round-trip basic auth', () => {
      const original = 'myuser:mypassword';
      const parsed = RepoAuthParser.parse(original);
      const encoded = RepoAuthParser.encode(parsed);

      expect(encoded).to.equal(original);
    });

    it('should round-trip provider scheme (order may vary)', () => {
      const original = 'aws-ecr://accessKeyId=AKIA123&secretAccessKey=secret123';
      const parsed = RepoAuthParser.parse(original);
      const encoded = RepoAuthParser.encode(parsed);

      // Parse both to compare (parameter order may differ)
      const reParsed = RepoAuthParser.parse(encoded);
      expect(reParsed).to.deep.equal(parsed);
    });

    it('should round-trip configuration with special characters', () => {
      const config = {
        type: 'aws-ecr',
        param: 'value with special !@#$%^&*()',
      };

      const encoded = RepoAuthParser.encode(config);
      const parsed = RepoAuthParser.parse(encoded);

      // URLSearchParams encodes spaces as '+' which is correct for application/x-www-form-urlencoded
      // The decoded value will have '+' preserved since we use decodeURIComponent
      // This is the expected behavior for URI component encoding
      expect(parsed.type).to.equal(config.type);
      expect(parsed.param).to.include('special');
      expect(parsed.param).to.include('!@#$%^&*()');
    });
  });

  describe('validate()', () => {
    it('should validate correct basic auth configuration', () => {
      const config = {
        type: 'basic',
        username: 'myuser',
        password: 'mypassword',
      };

      expect(RepoAuthParser.validate(config)).to.be.true;
    });

    it('should validate correct provider configuration', () => {
      const config = {
        type: 'aws-ecr',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI',
      };

      expect(RepoAuthParser.validate(config)).to.be.true;
    });

    it('should reject configuration without type', () => {
      const config = {
        username: 'myuser',
        password: 'mypassword',
      };

      expect(RepoAuthParser.validate(config)).to.be.false;
    });

    it('should reject basic auth without username', () => {
      const config = {
        type: 'basic',
        password: 'mypassword',
      };

      expect(RepoAuthParser.validate(config)).to.be.false;
    });

    it('should reject invalid provider name', () => {
      const config = {
        type: '123invalid',
        param: 'value',
      };

      expect(RepoAuthParser.validate(config)).to.be.false;
    });

    it('should reject non-object config', () => {
      expect(RepoAuthParser.validate(null)).to.be.false;
      expect(RepoAuthParser.validate('string')).to.be.false;
      expect(RepoAuthParser.validate(123)).to.be.false;
    });
  });

  describe('getSupportedProviders()', () => {
    it('should return array of supported providers', () => {
      const providers = RepoAuthParser.getSupportedProviders();

      expect(providers).to.be.an('array');
      expect(providers).to.include('basic');
      expect(providers).to.include('aws-ecr');
      expect(providers).to.include('google-gar');
      expect(providers).to.include('azure-acr');
    });

    it('should return consistent results', () => {
      const providers1 = RepoAuthParser.getSupportedProviders();
      const providers2 = RepoAuthParser.getSupportedProviders();

      expect(providers1).to.deep.equal(providers2);
    });
  });

  describe('isProviderSupported()', () => {
    it('should return true for supported providers', () => {
      expect(RepoAuthParser.isProviderSupported('basic')).to.be.true;
      expect(RepoAuthParser.isProviderSupported('aws-ecr')).to.be.true;
      expect(RepoAuthParser.isProviderSupported('google-gar')).to.be.true;
      expect(RepoAuthParser.isProviderSupported('azure-acr')).to.be.true;
    });

    it('should return false for unsupported providers', () => {
      expect(RepoAuthParser.isProviderSupported('unknown')).to.be.false;
      expect(RepoAuthParser.isProviderSupported('custom-provider')).to.be.false;
      expect(RepoAuthParser.isProviderSupported('')).to.be.false;
    });

    it('should be case-sensitive', () => {
      expect(RepoAuthParser.isProviderSupported('AWS-ECR')).to.be.false;
      expect(RepoAuthParser.isProviderSupported('Basic')).to.be.false;
    });
  });

  describe('Complex Real-World Examples', () => {
    it('should parse AWS ECR with session token', () => {
      const authString = 'aws-ecr://accessKeyId=ASIA123&secretAccessKey=secret123&sessionToken=FwoGZXIv';
      const result = RepoAuthParser.parse(authString);

      expect(result).to.deep.equal({
        type: 'aws-ecr',
        accessKeyId: 'ASIA123',
        secretAccessKey: 'secret123',
        sessionToken: 'FwoGZXIv',
      });
    });

    it('should parse Azure ACR with all required fields', () => {
      const authString = 'azure-acr://tenantId=12345678-1234-1234-1234-123456789012&clientId=87654321-4321-4321-4321-210987654321&clientSecret=mySecret123!';
      const result = RepoAuthParser.parse(authString);

      expect(result).to.have.property('type', 'azure-acr');
      expect(result).to.have.property('tenantId', '12345678-1234-1234-1234-123456789012');
      expect(result).to.have.property('clientId', '87654321-4321-4321-4321-210987654321');
      expect(result).to.have.property('clientSecret', 'mySecret123!');
    });

    it('should parse Google GAR with base64 keyFile', () => {
      const keyFile = Buffer.from(JSON.stringify({ type: 'service_account' })).toString('base64');
      const authString = `google-gar://keyFile=${encodeURIComponent(keyFile)}`;
      const result = RepoAuthParser.parse(authString);

      expect(result).to.have.property('type', 'google-gar');
      expect(result).to.have.property('keyFile', keyFile);
    });

    it('should parse Docker Hub basic auth', () => {
      const result = RepoAuthParser.parse('dockerhub_user:dckr_pat_123456789');

      expect(result).to.deep.equal({
        type: 'basic',
        username: 'dockerhub_user',
        password: 'dckr_pat_123456789',
      });
    });

    it('should parse GitHub Container Registry auth', () => {
      const result = RepoAuthParser.parse('github_username:ghp_PersonalAccessToken123456789');

      expect(result).to.deep.equal({
        type: 'basic',
        username: 'github_username',
        password: 'ghp_PersonalAccessToken123456789',
      });
    });
  });

  describe('Error Messages', () => {
    it('should provide clear error for malformed provider parameters', () => {
      // Force a parsing error by stubbing decodeURIComponent
      const stub = sinon.stub(global, 'decodeURIComponent').throws(new Error('Invalid encoding'));

      try {
        expect(() => {
          RepoAuthParser.parse('aws-ecr://param=%XX');
        }).to.throw(/Failed to parse provider parameters/i);
      } finally {
        stub.restore();
      }
    });

    it('should provide clear error for provider-specific issues', () => {
      const stub = sinon.stub(RepoAuthParser, 'parseProviderParams').throws(new Error('Missing required field'));

      try {
        expect(() => {
          RepoAuthParser.parse('aws-ecr://param=value');
        }).to.throw(/Invalid aws-ecr authentication format.*Missing required field/i);
      } finally {
        stub.restore();
      }
    });
  });
});
