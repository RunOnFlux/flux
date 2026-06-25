const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();
const mountParser = require('../../ZelBack/src/services/utils/mountParser');

// Stub the lazy dockerService.getAppIdentifier require so constructVolumes is
// isolated from the docker stack (it only needs the flux-prefixed name).
const volumeConstructor = proxyquire('../../ZelBack/src/services/utils/volumeConstructor', {
  '../dockerService': { getAppIdentifier: (id) => `flux${id}` },
});

// VALID real containerData shapes observed across all global app specs (707 apps /
// 861 components, 2026-06-09). The parser only permits sync flags (g:/r:/s:) on the
// PRIMARY mount; additional mounts may be index-ref / m: / f: / c: / cf: (never sync
// flags). `synced` = the primary mount carries g:/r:/s:.
const VALID_CATALOG = [
  { cd: '/data', synced: false, desc: 'plain primary' },
  { cd: 'g:/server/AbioticFactor/Saved', synced: true, desc: 'g: primary' },
  { cd: 'r:/root', synced: true, desc: 'r: primary' },
  { cd: 's:/db/', synced: true, desc: 's: primary' },
  { cd: 'g:/etc/opt/simplex-xftp|0:/srv/xftp|0:/var/opt/simplex-xftp', synced: true, desc: 'g: + 2 index-refs (simplexftp)' },
  { cd: 'g:/baserow/data|0:/var/lib/postgresql', synced: true, desc: 'g: + index-ref (baserow shape)' },
  { cd: 'r:/data|0:/etc/letsencrypt', synced: true, desc: 'r: + index-ref' },
  { cd: 'g:/root|0:/var/www/onlyoffice/Data|0:/var/log/onlyoffice|0:/var/lib/onlyoffice', synced: true, desc: 'g: + 3 index-refs (onlyoffice)' },
  { cd: '/data|m:logs:/var/log', synced: false, desc: 'plain + named mount' },
  { cd: 'g:/home/steam/enshrouded/savegame|f:enshrouded_server.json:/home/steam/conf', synced: true, desc: 'g: + file mount (enshrouded)' },
  { cd: 'g:/etc/x-ui|m:logs:/var/log|f:config.yaml:/etc/config.yaml', synced: true, desc: 'g: + named + file (x-ui)' },
  { cd: 'r:/var/lib/postgresql/data|0:/config/sql|0:/docker-entrypoint-initdb.d', synced: true, desc: 'r: + 2 index-refs' },
];

// UNSUPPORTED real specs: the parser rejects these outright. Sync flags are only
// valid on the primary mount, and the primary cannot be an index-ref. These are the
// shapes behind the roundcube/rainloop network-wide outage — they are invalid specs
// that registration should have rejected (see BUG-gapp-nonprimary-sync-segment.md).
const UNSUPPORTED = [
  { cd: '/data|g:/var/roundcube/db', desc: 'sync flag on a NON-primary mount (roundcube)' },
  { cd: '0:/rainloop/data|g:/var/www/html/data', desc: 'index-ref as primary + sync on non-primary (rainloop)' },
];

describe('volumeConstructor — real-world containerData catalog', () => {
  describe('getSyncthingMounts detects sync from the (primary) mount flags', () => {
    VALID_CATALOG.forEach(({ cd, synced, desc }) => {
      it(`${synced ? 'flags' : 'does not flag'} sync for ${desc}: ${cd}`, () => {
        const parsed = mountParser.parseContainerData(cd);
        const syncMounts = volumeConstructor.getSyncthingMounts(parsed);
        expect(syncMounts.length > 0, JSON.stringify(syncMounts)).to.equal(synced);
      });
    });
  });

  describe('canonical classifier (mountParser.isGComponent / isSyncedComponent / getComponentSyncMode)', () => {
    VALID_CATALOG.forEach(({ cd, synced }) => {
      it(`isSyncedComponent=${synced} for ${cd}`, () => {
        expect(mountParser.isSyncedComponent(cd)).to.equal(synced);
      });
    });

    it('classifies g: vs r: vs s: vs plain on the primary mount', () => {
      expect(mountParser.getComponentSyncMode('g:/data')).to.equal('g');
      expect(mountParser.getComponentSyncMode('r:/data')).to.equal('r');
      expect(mountParser.getComponentSyncMode('s:/data')).to.equal('s');
      expect(mountParser.getComponentSyncMode('/data')).to.equal(null);
    });

    it('does NOT adopt the malformed outage shapes as g: (unlike .includes("g:"))', () => {
      // The whole bug: `.includes('g:')` returns true for these and adopts them into
      // a masterSlave deadlock. The canonical, parse-based classifier returns false
      // (and never throws) so they are not adopted as synced components.
      UNSUPPORTED.forEach(({ cd }) => {
        expect(cd.includes('g:'), 'precondition: substring match is the buggy true').to.equal(true);
        expect(mountParser.isGComponent(cd)).to.equal(false);
        expect(mountParser.isSyncedComponent(cd)).to.equal(false);
        expect(mountParser.getComponentSyncMode(cd)).to.equal(null);
      });
    });

    it('hasFlag no longer false-positives on a flagless path containing the flag letter', () => {
      // old substring hasFlag('/dogs/data','g') === true (the 'g' in "dogs"); now false.
      expect(mountParser.hasFlag('/dogs/data', 'g')).to.equal(false);
      expect(mountParser.hasFlag('g:/data', 'g')).to.equal(true);
      expect(mountParser.hasFlag('/data|g:/db', 'g')).to.equal(false); // g: not on primary
    });
  });

  describe('parser rejects unsupported sync placements (the roundcube/rainloop outage shapes)', () => {
    // The model only supports sync on the PRIMARY mount; these production specs put
    // it elsewhere and are invalid. masterSlaveApps' loose `.includes('g:')` still
    // adopts them and then deadlocks waiting for a folder that is never created.
    UNSUPPORTED.forEach(({ cd, desc }) => {
      it(`throws for ${desc}: ${cd}`, () => {
        expect(() => mountParser.parseContainerData(cd)).to.throw(/Invalid primary mount syntax|Unknown mount syntax/);
      });
    });
  });

  describe('component index-ref validation (constructVolumes)', () => {
    it('resolves a valid lower-index reference (component 1 -> 0)', () => {
      const fullAppSpecs = {
        version: 4,
        name: 'app',
        compose: [
          { name: 'c0', containerData: 'g:/appdata' },
          { name: 'c1', containerData: '/own|0:/shared' },
        ],
      };
      const parsed = mountParser.parseContainerData('/own|0:/shared');
      const volumes = volumeConstructor.constructVolumes(parsed, 'c1_app', 'app', fullAppSpecs, fullAppSpecs.compose[1]);
      const refMount = volumes.find((v) => v.Target === '/shared');
      expect(refMount, JSON.stringify(volumes)).to.exist;
      // index-ref 0: must resolve to component 0's (c0) appdata, not c1's
      expect(refMount.Source).to.contain('fluxc0_app');
    });

    it('rejects a single-component self-reference (baserow-class: index 0 -> 0)', () => {
      const fullAppSpecs = {
        version: 4,
        name: 'app',
        compose: [{ name: 'c0', containerData: 'g:/appdata|0:/selfref' }],
      };
      const parsed = mountParser.parseContainerData('g:/appdata|0:/selfref');
      expect(() => volumeConstructor.constructVolumes(parsed, 'c0_app', 'app', fullAppSpecs, fullAppSpecs.compose[0]))
        .to.throw(/cannot reference component/i);
    });

    it('rejects a forward reference (component 0 -> 1)', () => {
      const fullAppSpecs = {
        version: 4,
        name: 'app',
        compose: [
          { name: 'c0', containerData: '/data|1:/peer' },
          { name: 'c1', containerData: 'g:/appdata' },
        ],
      };
      const parsed = mountParser.parseContainerData('/data|1:/peer');
      expect(() => volumeConstructor.constructVolumes(parsed, 'c0_app', 'app', fullAppSpecs, fullAppSpecs.compose[0]))
        .to.throw(/lower indices/i);
    });

    it('rejects an out-of-range component index', () => {
      const fullAppSpecs = {
        version: 4,
        name: 'app',
        compose: [
          { name: 'c0', containerData: 'g:/appdata' },
          { name: 'c1', containerData: '/own|5:/nope' },
        ],
      };
      const parsed = mountParser.parseContainerData('/own|5:/nope');
      expect(() => volumeConstructor.constructVolumes(parsed, 'c1_app', 'app', fullAppSpecs, fullAppSpecs.compose[1]))
        .to.throw(/Invalid component index/i);
    });
  });
});
