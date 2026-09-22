const { expect } = require('chai');
const mountParser = require('../../ZelBack/src/services/utils/mountParser');
const { syncthingIgnoreLines } = require('../../ZelBack/src/services/appSystem/volumeReservedNames');

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

    it('should reject a mount named after syncthing\'s ignore file', () => {
      expect(() => {
        mountParser.parseContainerData('/data|f:.stignore:/etc/ignores');
      }).to.throw('reserved name');
    });

    it('should reject a mount named after syncthing\'s folder marker', () => {
      expect(() => {
        mountParser.parseContainerData('/data|m:.stfolder:/marker');
      }).to.throw('reserved name');
    });

    it('should reject a mount that takes an operation staging name', () => {
      expect(() => {
        mountParser.parseContainerData('/data|m:.flux-op-0f3a1c2b-1111-2222-3333-444455556666:/staging');
      }).to.throw('reserved name');
    });

    it('should reject a mount named lost+found', () => {
      expect(() => {
        mountParser.parseContainerData('/data|m:lost+found:/orphans');
      }).to.throw('reserved name');
    });

    it('should allow a name that only resembles an operation staging name', () => {
      const parsed = mountParser.parseContainerData('/data|m:.flux-op-backups:/archive');
      expect(parsed.allMounts.map((m) => m.subdir)).to.include('.flux-op-backups');
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

  describe('flag segment strictness', () => {
    // Contract: a two-part primary's first segment is a flag segment only when it
    // consists entirely of known flag letters (r, g, s). A word that merely CONTAINS
    // flag letters (e.g. 'logs', 'config') is not a flag segment — it is invalid
    // primary syntax and must fail loud, exactly like garbage without flag letters
    // ('data:/x') always has. Misreading such a word as flags silently adopts the
    // app into sync management (g:) that can never converge.
    const garbageFlagSegments = [
      { cd: 'logs:/var/log', desc: "'logs' contains g and s" },
      { cd: 'config:/etc/app', desc: "'config' contains g" },
      { cd: 'gx:/data', desc: "'gx' mixes a flag letter with a non-flag letter" },
      { cd: 'data:/x', desc: "'data' contains no flag letters (existing behavior)" },
      { cd: 'G:/data', desc: 'flags are lowercase only' },
      { cd: ':/data', desc: 'empty first segment' },
    ];

    garbageFlagSegments.forEach(({ cd, desc }) => {
      it(`rejects non-flag first segment: ${desc} (${cd})`, () => {
        expect(() => mountParser.parseContainerData(cd)).to.throw('Invalid primary mount syntax');
      });

      it(`never classifies ${cd} as a synced component`, () => {
        expect(mountParser.getComponentSyncMode(cd)).to.equal(null);
        expect(mountParser.isGComponent(cd)).to.be.false;
        expect(mountParser.isSyncedComponent(cd)).to.be.false;
      });
    });

    it('still parses pure flag segments, including repeated letters', () => {
      expect(mountParser.parseContainerData('rs:/data').primary.flags).to.have.members(['r', 's']);
      expect(mountParser.parseContainerData('gs:/data').primary.flags).to.have.members(['g', 's']);
      // repeated letters are valid flag segments; each flag is reported once
      expect(mountParser.parseContainerData('gg:/data').primary.flags).to.deep.equal(['g']);
    });
  });

  describe('ml: local directory mounts', () => {
    it('parses ml: as its own mount type', () => {
      const result = mountParser.parseContainerData('g:/savegame|ml:game:/home/steam/game');
      expect(result.additional[0].type).to.equal(mountParser.MountType.LOCAL_DIRECTORY);
      expect(result.additional[0].subdir).to.equal('game');
      expect(result.additional[0].containerPath).to.equal('/home/steam/game');
      expect(result.additional[0].flags).to.deep.equal([]);
    });

    it('creates the directory like any other local mount', () => {
      const parsed = mountParser.parseContainerData('g:/savegame|ml:game:/home/steam/game');
      expect(mountParser.getRequiredLocalPaths(parsed).map((entry) => entry.name))
        .to.deep.equal(['appdata', 'game']);
    });

    it('reports its subdir as unsynced, and reports nothing for the other forms', () => {
      expect(mountParser.getUnsyncedSubdirs('g:/savegame|ml:game:/g|ml:cache:/c'))
        .to.deep.equal(['game', 'cache']);
      expect(mountParser.getUnsyncedSubdirs('g:/savegame|m:logs:/var/log|f:a.json:/a.json'))
        .to.deep.equal([]);
    });

    it('answers [] for an unparseable spec rather than throwing', () => {
      expect(mountParser.getUnsyncedSubdirs('ml:')).to.deep.equal([]);
      expect(mountParser.getUnsyncedSubdirs(undefined)).to.deep.equal([]);
    });

    it('collides with another mount claiming the same subdir', () => {
      expect(() => mountParser.parseContainerData('/data|m:game:/a|ml:game:/b'))
        .to.throw(/Duplicate subdirectory/);
    });

    it('refuses reserved volume-root names', () => {
      expect(() => mountParser.parseContainerData('/data|ml:appdata:/a')).to.throw(/reserved name/);
      expect(() => mountParser.parseContainerData('/data|ml:lost+found:/a')).to.throw(/reserved name/);
    });

    // The name is asserted as a syncthing ignore pattern, so one carrying pattern
    // syntax stands for some other set of entries: `/[a]ppdata` excludes the
    // component's synced storage and leaves the directory actually named
    // `[a]ppdata` replicating - the reverse of the spec, on every node, silently.
    ['[a]ppdata', '{appdata,cache}', 'back\\slash'].forEach((name) => {
      it(`refuses a name syncthing would read as a pattern: ${name}`, () => {
        expect(() => mountParser.parseContainerData(`/data|ml:${name}:/a`))
          .to.throw(/may not contain/);
      });
    });

    // The derived lines are joined with a newline and written as one document, so a
    // name carrying a line terminator writes a SECOND line the specification never
    // named - and the converge reads back more lines than it derived, so it rewrites
    // the file and rescans the folder every pass for as long as the app exists.
    [['newline', 'cache\nsecret'], ['carriage return', 'cache\rsecret'], ['tab', 'ca\tche'], ['delete', 'cache\u007f']]
      .forEach(([what, name]) => {
        it(`refuses a name carrying a ${what}`, () => {
          expect(() => mountParser.parseContainerData(`/data|ml:${name}:/a`))
            .to.throw(/may not contain/);
        });
      });

    // Refused before the rule above sees them, by the character set every mount name
    // is held to. Named here because the ignore line is the reason they must stay out.
    ['star*', 'quer?y'].forEach((name) => {
      it(`refuses a wildcard in a name: ${name}`, () => {
        expect(() => mountParser.parseContainerData(`/data|ml:${name}:/a`))
          .to.throw(/invalid characters/);
      });
    });

    it('still accepts the ordinary names an ignore line can carry', () => {
      expect(mountParser.getUnsyncedSubdirs('/data|ml:steam-content.v2:/a|ml:build_cache:/b'))
        .to.deep.equal(['steam-content.v2', 'build_cache']);
    });

    // What the refusal is for: one declared name, one derived line.
    it('derives exactly one ignore line per declared directory', () => {
      const lines = syncthingIgnoreLines(mountParser.getUnsyncedSubdirs('/data|ml:cache:/a'));
      expect(lines).to.deep.equal(['/backup', '/lost+found', '/.flux-op', '/.flux-op-*', '/cache']);
      expect(lines.join('\n').split('\n')).to.have.length(lines.length);
    });

    it('is not a primary mount - the primary carries the sync mode', () => {
      expect(() => mountParser.parseContainerData('ml:game:/home/steam/game'))
        .to.throw(/Invalid primary mount syntax/);
    });

    it('leaves the component sync mode to the primary', () => {
      expect(mountParser.getComponentSyncMode('g:/savegame|ml:game:/g')).to.equal('g');
      expect(mountParser.getComponentSyncMode('/savegame|ml:game:/g')).to.equal(null);
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
