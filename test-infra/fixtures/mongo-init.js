// Pre-seed explorer scanned height for all 16 nodes so the explorer
// starts near the daemon tip instead of scanning from block 694000.
// Mounted into /docker-entrypoint-initdb.d/ — runs once on first boot.

const INITIAL_HEIGHT = 2100000;
const NODE_COUNT = 16;

for (let i = 1; i <= NODE_COUNT; i++) {
  const num = String(i).padStart(2, '0');
  const dbName = `node${num}_zelcashdata`;
  const nodeDb = db.getSiblingDB(dbName);
  if (nodeDb.scannedheight.countDocuments() === 0) {
    nodeDb.scannedheight.insertOne({ generalScannedHeight: INITIAL_HEIGHT });
    print(`Pre-seeded ${dbName}.scannedheight to ${INITIAL_HEIGHT}`);
  }
}
