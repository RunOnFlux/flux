// Pre-seed explorer scanned height for all 16 nodes so the explorer
// starts near the daemon tip instead of scanning from block 694000.
// Mounted into /docker-entrypoint-initdb.d/ — runs once on first boot.

const INITIAL_HEIGHT = 2100000;
const NODE_COUNT = 16;

for (let i = 1; i <= NODE_COUNT; i++) {
  const num = String(i).padStart(2, '0');

  // Explorer scanned height
  const explorerDb = db.getSiblingDB(`node${num}_zelcashdata`);
  if (explorerDb.scannedheight.countDocuments() === 0) {
    explorerDb.scannedheight.insertOne({ generalScannedHeight: INITIAL_HEIGHT });
    print(`Pre-seeded node${num} scannedheight to ${INITIAL_HEIGHT}`);
  }

  // Geolocation — spawner requires this before installing any app
  const localDb = db.getSiblingDB(`node${num}_zelfluxlocal`);
  if (localDb.geolocation.countDocuments() === 0) {
    localDb.geolocation.insertOne({
      _id: 'nodeGeolocation',
      geolocation: {
        ip: `198.18.${i}.0`,
        continent: 'Europe',
        continentCode: 'EU',
        country: 'Germany',
        countryCode: 'DE',
        region: 'HE',
        regionName: 'Hesse',
        lat: 50.1109,
        lon: 8.6821,
        org: 'Test Network',
        static: true,
        dataCenter: true,
      },
      staticIp: true,
      dataCenter: true,
      lastIpChangeDate: null,
      updatedAt: Date.now(),
    });
    print(`Pre-seeded node${num} geolocation`);
  }
}
