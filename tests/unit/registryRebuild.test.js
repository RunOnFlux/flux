// The registry rebuild and the lock every registry write shares with it.
//
// A rebuild builds a staging collection and renames it over the live registry.
// Two properties follow from that and are asserted here against a real mongod:
// readers never see the registry empty while it is rebuilt, and a write made
// while the rebuild runs is kept - because it waits for the lock and lands on
// the collection the rebuild produced. The last block reads the source: every
// write to the registry has to sit inside withRegistryWrite, or the swap can
// discard it.

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const espree = require('espree');

const dbHelper = require('../../ZelBack/src/services/dbHelper');
const { withRegistryWrite } = require('../../ZelBack/src/services/appDatabase/registryWriteLock');
const { requireMongo } = require('./dbTestHelper');

const MESSAGES = 'zelappsmessages';
const INFO = 'zelappsinformation';
const LOCAL_INFO = 'zelappsinformation';
const APPS = 3000;
const HEIGHT = 1000;

describe('registry rebuild', () => {
  let globalDb;
  let localDb;
  const globalName = `registryRebuildTest_${process.pid}_global`;
  const localName = `registryRebuildTest_${process.pid}_local`;

  const message = (name, height) => ({
    type: 'fluxappregister',
    version: 1,
    hash: `${name}-${height}`,
    height,
    appSpecifications: { name, version: 3, expire: 1_000_000 },
  });

  // What promotion does: replace the app's row by name unless it already holds
  // this height or a later one.
  const promote = async (msg) => {
    const row = { ...msg.appSpecifications, hash: msg.hash, height: msg.height };
    const existing = await globalDb.collection(INFO).findOne({ name: row.name });
    if (existing && existing.height >= row.height) return;
    await globalDb.collection(INFO).replaceOne({ name: row.name }, row, { upsert: true });
  };

  const rebuild = () => dbHelper.reindexGlobalAppsInformation(
    globalDb, localDb, MESSAGES, INFO, LOCAL_INFO, HEIGHT,
  );

  // Resolves once the rebuild has created its staging collection, which is the
  // window a concurrent write has to land in to be at risk.
  const stagingExists = async () => {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const names = (await globalDb.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
      if (names.includes(`${INFO}_rebuild`)) return;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setImmediate(resolve); });
    }
  };

  before(async function setUp() {
    await requireMongo.call(this);
    const client = dbHelper.databaseConnection();
    globalDb = client.db(globalName);
    localDb = client.db(localName);
  });

  beforeEach(async () => {
    await globalDb.dropDatabase();
    await localDb.dropDatabase();
    const docs = [];
    for (let i = 0; i < APPS; i += 1) docs.push(message(`app${i}`, HEIGHT));
    await globalDb.collection(MESSAGES).insertMany(docs);
    // The registry as it stood before the rebuild: one row per app.
    await globalDb.collection(INFO).insertMany(docs.map((d) => ({ ...d.appSpecifications, hash: d.hash, height: d.height })));
  });

  after(async () => {
    if (globalDb) await globalDb.dropDatabase();
    if (localDb) await localDb.dropDatabase();
  });

  it('rebuilds one row per live app from the messages', async () => {
    await rebuild();
    expect(await globalDb.collection(INFO).countDocuments()).to.equal(APPS);
  });

  // A read in flight at the instant of the rename has its cursor closed by
  // mongod and fails; it never answers from a half-built registry.
  it('is never empty or partial to a reader while it is rebuilt', async () => {
    let lowest = Infinity;
    let reads = 0;
    const otherErrors = [];
    let done = false;
    const watching = (async () => {
      while (!done) {
        try {
          // eslint-disable-next-line no-await-in-loop
          lowest = Math.min(lowest, await globalDb.collection(INFO).countDocuments());
          reads += 1;
        } catch (error) {
          if (!/collection dropped/.test(error.message)) otherErrors.push(error.message);
        }
      }
    })();
    await rebuild();
    done = true;
    await watching;
    // Anchored on the watcher having looked at all: a count never taken is also
    // never below APPS.
    expect(reads).to.be.greaterThan(1);
    expect(otherErrors).to.deep.equal([]);
    expect(lowest).to.equal(APPS);
  });

  it('keeps a write made while it runs, exactly once, when the write takes the lock', async () => {
    const running = rebuild();
    await stagingExists();
    // No message the rebuild could read it back from - the case of a message
    // stored after the rebuild read the messages - so only the write itself can
    // put this row in the registry, and only the lock keeps it there.
    await withRegistryWrite(() => promote(message('arrivedDuringRebuild', HEIGHT + 1)));
    await running;
    expect(await globalDb.collection(INFO).countDocuments({ name: 'arrivedDuringRebuild' })).to.equal(1);
  });

  // The canary for the test above: the same write made without the lock is
  // discarded by the swap. If this ever stops holding, the test above no longer
  // puts its write inside the window it is meant to cover.
  it('discards a write made while it runs without the lock - the reason every writer takes it', async () => {
    const running = rebuild();
    await stagingExists();
    // Promoted without the lock, and without a message the rebuild could read it
    // back from: only the write itself can put this row in the registry.
    await promote(message('unlockedWrite', HEIGHT + 1));
    await running;
    expect(await globalDb.collection(INFO).countDocuments({ name: 'unlockedWrite' })).to.equal(0);
  });
});

describe('registry writes', () => {
  const SRC = path.join(__dirname, '../../ZelBack/src');
  const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [path.relative(SRC, full)] : [];
  });
  const FILES = sourceFiles(SRC);
  const WRITES = new Set([
    'insertOneToDatabase', 'insertManyToDatabase', 'replaceOneInDatabase', 'updateOneInDatabase',
    'updateInDatabase', 'findOneAndUpdateInDatabase', 'removeDocumentsFromCollection',
    'findOneAndDeleteInDatabase', 'dropCollection', 'deleteMany', 'bulkWrite', 'rename',
  ]);
  const REGISTRY_NAMES = new Set(['globalAppsInformation', 'globalAppsInformationCol', 'globalAppsInfoCollection']);

  const namesRegistry = (node, src) => {
    if (!node) return false;
    if (node.type === 'Identifier') return REGISTRY_NAMES.has(node.name);
    return src.slice(node.range[0], node.range[1]).endsWith('collections.appsInformation');
  };

  // Every call that writes the registry, with whether it sits inside a function
  // handed to withRegistryWrite.
  const registryWrites = (file) => {
    const src = fs.readFileSync(path.join(SRC, file), 'utf8');
    const ast = espree.parse(src, { ecmaVersion: 2022, sourceType: 'script', range: true });
    const found = [];
    const visit = (node, lockedAncestor) => {
      if (!node || typeof node.type !== 'string') return;
      let locked = lockedAncestor;
      if (node.type === 'CallExpression') {
        const { callee } = node;
        if (callee.type === 'Identifier' && callee.name === 'withRegistryWrite') locked = true;
        const method = callee.type === 'MemberExpression' ? callee.property.name : null;
        if (WRITES.has(method) && node.arguments.some((arg) => namesRegistry(arg, src))) {
          found.push({ file, line: src.slice(0, node.range[0]).split('\n').length, locked: lockedAncestor });
        }
      }
      Object.keys(node).forEach((key) => {
        const value = node[key];
        if (Array.isArray(value)) value.forEach((child) => visit(child, locked));
        else if (value && typeof value.type === 'string') visit(value, locked);
      });
    };
    visit(ast, false);
    return found;
  };

  const all = FILES.flatMap(registryWrites);

  it('finds the registry writes it is looking for, so an empty sweep cannot pass', () => {
    expect(all.length).to.be.at.least(6);
  });

  it('holds every one of them to the registry write lock', () => {
    const unlocked = all.filter((w) => !w.locked).map((w) => `${w.file}:${w.line}`);
    expect(unlocked).to.deep.equal([]);
  });
});
