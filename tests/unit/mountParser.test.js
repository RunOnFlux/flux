const { expect } = require('chai');
const mountParser = require('../../ZelBack/src/services/utils/mountParser');

describe('mountParser tests', () => {
  describe('parseContainerData tests', () => {
    it('should parse simple primary mount', () => {
      const result = mountParser.parseContainerData('/data');
      expect(result.primary.type).to.equal('primary');
      expect(result.primary.containerPath).to.equal('/data');
      expect(result.primary.subdir).to.equal('appdata');
      expect(result.primary.flags).to.deep.equal([]);
      expect(result.additional).to.have.lengthOf(0);
    });

    it('should parse paths containing flag characters (r, g, s) without treating them as flags', () => {
      // Test common paths that contain 'r', 'g', 's' characters
      const testCases = [
        '/var/lib/mysql', // contains 'r' in 'var'
        '/usr/share/nginx', // contains 'r' in 'usr', 's' in 'usr' and 'share', 'g' in 'nginx'
        '/storage/data', // contains 's', 'r', 'g' in 'storage'
      ];

      testCases.forEach((path) => {
        const result = mountParser.parseContainerData(path);
        expect(result.primary.type).to.equal('primary');
        expect(result.primary.containerPath).to.equal(path);
        expect(result.primary.subdir).to.equal('appdata');
        expect(result.primary.flags).to.deep.equal([]);
        expect(result.additional).to.have.lengthOf(0);
      });
    });

    it('should parse primary mount with r flag', () => {
      const result = mountParser.parseContainerData('r:/data');
      expect(result.primary.type).to.equal('primary');
      expect(result.primary.containerPath).to.equal('/data');
      expect(result.primary.flags).to.include('r');
    });

    it('should parse primary mount with multiple flags', () => {
      const result = mountParser.parseContainerData('rgs:/data');
      expect(result.primary.flags).to.have.members(['r', 'g', 's']);
    });

    it('should parse component reference (backward compatible)', () => {
      const result = mountParser.parseContainerData('/data|0:/shared');
      expect(result.primary.containerPath).to.equal('/data');
      expect(result.additional).to.have.lengthOf(1);
      expect(result.additional[0].type).to.equal('component_primary');
      expect(result.additional[0].componentIndex).to.equal(0);
      expect(result.additional[0].containerPath).to.equal('/shared');
    });

    it('should parse directory mount', () => {
      const result = mountParser.parseContainerData('/data|m:logs:/var/log');
      expect(result.additional).to.have.lengthOf(1);
      expect(result.additional[0].type).to.equal('directory');
      expect(result.additional[0].subdir).to.equal('logs');
      expect(result.additional[0].containerPath).to.equal('/var/log');
      expect(result.additional[0].isFile).to.be.false;
    });

    it('should parse file mount (always empty)', () => {
      const result = mountParser.parseContainerData('/data|f:config.yaml:/etc/config.yaml');
      expect(result.additional).to.have.lengthOf(1);
      expect(result.additional[0].type).to.equal('file');
      expect(result.additional[0].subdir).to.equal('config.yaml');
      expect(result.additional[0].containerPath).to.equal('/etc/config.yaml');
      expect(result.additional[0].isFile).to.be.true;
    });

    it('should reject file mount with extra parameters', () => {
      expect(() => {
        mountParser.parseContainerData('/data|f:config.yaml:/etc/config.yaml:extraParam');
      }).to.throw('Invalid file mount syntax');
    });

    it('should parse component directory mount', () => {
      const result = mountParser.parseContainerData('/data|c:0:backups:/backups');
      expect(result.additional).to.have.lengthOf(1);
      expect(result.additional[0].type).to.equal('component_directory');
      expect(result.additional[0].componentIndex).to.equal(0);
      expect(result.additional[0].subdir).to.equal('backups');
      expect(result.additional[0].containerPath).to.equal('/backups');
    });

    it('should parse component file mount', () => {
      const result = mountParser.parseContainerData('/data|cf:0:cert.pem:/etc/ssl/cert.pem');
      expect(result.additional).to.have.lengthOf(1);
      expect(result.additional[0].type).to.equal('component_file');
      expect(result.additional[0].componentIndex).to.equal(0);
      expect(result.additional[0].subdir).to.equal('cert.pem');
      expect(result.additional[0].containerPath).to.equal('/etc/ssl/cert.pem');
      expect(result.additional[0].isFile).to.be.true;
    });

    it('should parse complex multi-mount configuration', () => {
      const containerData = 'r:/data|m:logs:/var/log|f:config.yaml:/etc/config.yaml|0:/shared';
      const result = mountParser.parseContainerData(containerData);

      expect(result.allMounts).to.have.lengthOf(4);
      expect(result.primary.flags).to.include('r');
      expect(result.additional).to.have.lengthOf(3);

      // Check all mount types are parsed correctly
      const types = result.allMounts.map((m) => m.type);
      expect(types).to.include('primary');
      expect(types).to.include('directory');
      expect(types).to.include('file');
      expect(types).to.include('component_primary');
    });

    it('should reject duplicate container paths', () => {
      expect(() => {
        mountParser.parseContainerData('/data|m:logs:/data');
      }).to.throw('Duplicate container paths');
    });

    it('should reject duplicate subdirectories', () => {
      expect(() => {
        mountParser.parseContainerData('/data|m:logs:/var/log|m:logs:/var/log2');
      }).to.throw('Duplicate subdirectory/filename');
    });

    it('should reject directory traversal in container path', () => {
      expect(() => {
        mountParser.parseContainerData('/data/../etc');
      }).to.throw('directory traversal');
    });

    it('should reject directory traversal in subdirectory', () => {
      expect(() => {
        mountParser.parseContainerData('/data|m:../logs:/var/log');
      }).to.throw('cannot contain "/" or ".."');
    });

    it('should reject reserved subdirectory name appdata', () => {
      expect(() => {
        mountParser.parseContainerData('/data|m:appdata:/var/log');
      }).to.throw('reserved name');
    });

    it('should reject reserved subdirectory name backup', () => {
      expect(() => {
        mountParser.parseContainerData('/data|m:backup:/var/log');
      }).to.throw('reserved name');
    });

    it('should reject non-absolute container path', () => {
      expect(() => {
        mountParser.parseContainerData('data');
      }).to.throw('must be absolute');
    });

    it('should reject invalid mount syntax', () => {
      expect(() => {
        mountParser.parseContainerData('/data|invalid:syntax');
      }).to.throw('Unknown mount syntax');
    });
  });

  describe('getRequiredLocalPaths tests', () => {
    it('should return only local paths', () => {
      const parsed = mountParser.parseContainerData('r:/data|m:logs:/var/log|0:/shared');
      const paths = mountParser.getRequiredLocalPaths(parsed);

      expect(paths).to.have.lengthOf(2); // appdata and logs, not component ref
      expect(paths.map((p) => p.name)).to.include('appdata');
      expect(paths.map((p) => p.name)).to.include('logs');
      expect(paths.map((p) => p.name)).to.not.include('shared');
    });

    it('should correctly identify files vs directories', () => {
      const parsed = mountParser.parseContainerData('/data|m:logs:/var/log|f:config.yaml:/etc/config.yaml');
      const paths = mountParser.getRequiredLocalPaths(parsed);

      const appdata = paths.find((p) => p.name === 'appdata');
      const logs = paths.find((p) => p.name === 'logs');
      const config = paths.find((p) => p.name === 'config.yaml');

      expect(appdata.isFile).to.be.false;
      expect(logs.isFile).to.be.false;
      expect(config.isFile).to.be.true;
    });

    it('should include files in required paths (all created empty)', () => {
      const parsed = mountParser.parseContainerData('/data|f:config.yaml:/etc/config.yaml');
      const paths = mountParser.getRequiredLocalPaths(parsed);

      // File should be in required paths (empty file will be created)
      const config = paths.find((p) => p.name === 'config.yaml');
      expect(config).to.exist;
      expect(config.isFile).to.be.true;

      // Both appdata and config file should be present
      expect(paths).to.have.lengthOf(2);
      expect(paths.map((p) => p.name)).to.include('appdata');
      expect(paths.map((p) => p.name)).to.include('config.yaml');
    });

    it('should include all files (all created empty)', () => {
      const parsed = mountParser.parseContainerData('/data|f:empty1.txt:/etc/empty1.txt|f:empty2.txt:/etc/empty2.txt|f:empty3.txt:/etc/empty3.txt');
      const paths = mountParser.getRequiredLocalPaths(parsed);

      // All files should be present (empty files will be created for mounting)
      expect(paths).to.have.lengthOf(4);
      expect(paths.map((p) => p.name)).to.include('appdata');
      expect(paths.map((p) => p.name)).to.include('empty1.txt');
      expect(paths.map((p) => p.name)).to.include('empty2.txt');
      expect(paths.map((p) => p.name)).to.include('empty3.txt');
    });
  });

  describe('hasFlag tests', () => {
    it('should detect r flag', () => {
      expect(mountParser.hasFlag('r:/data', 'r')).to.be.true;
      expect(mountParser.hasFlag('/data', 'r')).to.be.false;
    });

    it('should detect g flag', () => {
      expect(mountParser.hasFlag('g:/data', 'g')).to.be.true;
      expect(mountParser.hasFlag('rgs:/data', 'g')).to.be.true;
    });

    it('should detect s flag', () => {
      expect(mountParser.hasFlag('s:/data', 's')).to.be.true;
      expect(mountParser.hasFlag('r:/data', 's')).to.be.false;
    });
  });

  describe('getPrimaryFlags tests', () => {
    it('should return empty array for no flags', () => {
      const parsed = mountParser.parseContainerData('/data');
      const flags = mountParser.getPrimaryFlags(parsed);
      expect(flags).to.be.an('array').that.is.empty;
    });

    it('should return flags array', () => {
      const parsed = mountParser.parseContainerData('rgs:/data');
      const flags = mountParser.getPrimaryFlags(parsed);
      expect(flags).to.have.members(['r', 'g', 's']);
    });
  });

  describe('Backward compatibility tests', () => {
    it('should handle legacy simple mount', () => {
      const result = mountParser.parseContainerData('r:/data');
      expect(result.primary.containerPath).to.equal('/data');
      expect(result.primary.subdir).to.equal('appdata');
    });

    it('should handle legacy component reference', () => {
      const result = mountParser.parseContainerData('/app|0:/shared|1:/config');
      expect(result.additional).to.have.lengthOf(2);
      expect(result.additional[0].componentIndex).to.equal(0);
      expect(result.additional[1].componentIndex).to.equal(1);
    });

    it('should handle legacy complex mounts', () => {
      const result = mountParser.parseContainerData('g:/primary|0:/secondary');
      expect(result.primary.flags).to.include('g');
      expect(result.additional[0].type).to.equal('component_primary');
    });
  });
});
