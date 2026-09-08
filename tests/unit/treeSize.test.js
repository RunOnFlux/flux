const { expect } = require('chai');
const { measureTree } = require('../../ZelBack/src/services/utils/treeSize');

// These tests are CPU-bound and share a box with whatever else is running on
// it, so their wall clock is set by contention rather than by the code under
// test. Measured idle on an 8-physical-core laptop, the two below take 1327ms
// and 1217ms against mocha's 2000ms default; with R runnable threads on C
// cores each gets C/R of a core, so the budget has to satisfy
//
//   worst_idle_ms * (R / C) < budget
//
// and 1327 * (69 / 8) = 11.4s at the highest load a gate has actually been run
// at here. 20s carries that with margin. Nothing is lost as a hang detector: a
// hang is not bounded by 20s either.
//
// The work is not incidental setup - the width and the depth ARE the
// assertions - so shrinking it to fit the default would delete what the tests
// are for.
const REAL_WORK_MS = 20000;

describe('treeSize tests', () => {
  const ROOT = '/vol';

  // blocks is what lstat reports allocated, in 512-byte units - a one-byte file
  // still occupies a whole filesystem block, which is the difference this module
  // now has to be able to express.
  const dir = (blocks = 8) => ({ isDirectory: () => true, isFile: () => false, size: 4096, blocks });
  const file = (size, blocks = Math.ceil(size / 4096) * 8) => ({
    isDirectory: () => false, isFile: () => true, size, blocks,
  });
  // Neither a file nor a directory, which is what lstat reports for a symlink.
  const link = () => ({ isDirectory: () => false, isFile: () => false });

  /** A filesystem described as a map of path -> entry, with children per dir. */
  const fakeFs = (entries, children = {}) => ({
    lstat: async (p) => {
      if (!(p in entries)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return entries[p];
    },
    readdir: async (p) => children[p] ?? [],
  });

  it('sums the files under a tree', async () => {
    const fs = fakeFs({
      [ROOT]: dir(),
      [`${ROOT}/a`]: file(100),
      [`${ROOT}/sub`]: dir(),
      [`${ROOT}/sub/b`]: file(250),
    }, {
      [ROOT]: ['a', 'sub'],
      [`${ROOT}/sub`]: ['b'],
    });

    expect(await measureTree(ROOT, fs)).to.equal(350);
  });

  it('measures a single file', async () => {
    const fs = fakeFs({ [ROOT]: file(42) });
    expect(await measureTree(ROOT, fs)).to.equal(42);
  });

  it('counts a symlink as nothing, and does not follow it', async () => {
    // The whole point of the module. An app owner writes into this volume, so a
    // link is attacker-supplied: following one leaves the volume entirely.
    const readdirCalls = [];
    const fs = {
      lstat: async (p) => {
        if (p === ROOT) return dir();
        if (p === `${ROOT}/escape`) return link();
        return file(10);
      },
      readdir: async (p) => {
        readdirCalls.push(p);
        return p === ROOT ? ['escape', 'real'] : [];
      },
    };

    expect(await measureTree(ROOT, fs)).to.equal(10);
    expect(readdirCalls, 'the link was descended into').to.deep.equal([ROOT]);
  });

  it('terminates on a link that points at its own parent', async () => {
    // `ln -s .. loop` inside a volume. The old walk stat'ed rather than lstat'ed,
    // so this resolved to a directory and recursed until the process died - from
    // a request path that runs before any container exists.
    const fs = {
      lstat: async (p) => (p === ROOT ? dir() : link()),
      readdir: async () => ['loop'],
    };

    expect(await measureTree(ROOT, fs)).to.equal(0);
  });



  it('skips an entry that vanished rather than failing the whole measurement', async () => {
    // A tree being written while it is measured loses entries between the
    // readdir and the lstat. That is not a reason to refuse a size.
    const fs = fakeFs({
      [ROOT]: dir(),
      [`${ROOT}/here`]: file(7),
    }, { [ROOT]: ['here', 'gone'] });

    expect(await measureTree(ROOT, fs)).to.equal(7);
  });

  it('stats in batches rather than one at a time', async () => {
    // Sequential is 1169ms for 20,000 files and 179ms at 32. The unbounded
    // fan-out this replaced was faster still and opened a handle per entry.
    let inFlight = 0;
    let peak = 0;
    const names = Array.from({ length: 500 }, (_, i) => `f${i}`);
    const fs = {
      lstat: async (p) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => { setImmediate(r); });
        inFlight -= 1;
        return p === ROOT ? dir() : file(1);
      },
      readdir: async () => names,
    };

    expect(await measureTree(ROOT, fs)).to.equal(500);
    expect(peak, 'not batched').to.be.greaterThan(1);
    expect(peak, 'unbounded fan-out').to.be.at.most(32);
  });

  it('does not recurse, so a deep tree cannot overflow the stack', async function () {
    this.timeout(REAL_WORK_MS);
    // 5000 levels: the previous implementation recursed once per level.
    const depth = 5000;
    const fs = {
      lstat: async (p) => (p.split('/').length - 1 < depth ? dir() : file(3)),
      readdir: async () => ['down'],
    };

    expect(await measureTree('/vol', fs)).to.equal(3);
  });

  describe('what a capacity check needs', () => {
    // A file occupies whole blocks, so a tree of tiny files consumes far more
    // than it reports. The figure this feeds is compared against free space,
    // which is counted in blocks - so the two have to be the same kind of
    // number, or a copy passes a check it has already exceeded.
    it('measures what the tree occupies rather than what its files say', async () => {
      const entries = { [ROOT]: dir() };
      const names = [];
      for (let i = 0; i < 100; i += 1) {
        names.push(`f${i}`);
        // One byte each, one 4096-byte block each.
        entries[`${ROOT}/f${i}`] = file(1, 8);
      }
      const fs = fakeFs(entries, { [ROOT]: names });

      expect(await measureTree(ROOT, fs)).to.equal(100);
      expect(await measureTree(ROOT, fs, { occupied: true })).to.equal(100 * 4096 + 4096);
    });

    it('counts the directories too, which hold blocks of their own', async () => {
      const fs = fakeFs({
        [ROOT]: dir(),
        [`${ROOT}/sub`]: dir(),
        [`${ROOT}/sub/a`]: file(1, 8),
      }, { [ROOT]: ['sub'], [`${ROOT}/sub`]: ['a'] });

      // Apparent counts the file alone; occupied counts both directories as well.
      expect(await measureTree(ROOT, fs)).to.equal(1);
      expect(await measureTree(ROOT, fs, { occupied: true })).to.equal(3 * 4096);
    });

    it('still counts a symlink as nothing', async () => {
      const fs = fakeFs({ [ROOT]: dir(), [`${ROOT}/link`]: link() }, { [ROOT]: ['link'] });
      expect(await measureTree(ROOT, fs, { occupied: true })).to.equal(4096);
    });
  });

  it('survives one directory holding two hundred thousand entries', async function () {
    this.timeout(REAL_WORK_MS);
    // One directory's fan-out, not the tree total: an app filling a mail spool
    // or a cache creates this from inside its own container, and the crash it
    // must not cause takes the folder listing dark and refuses copy and
    // compress for that app permanently. V8's argument limit sits between
    // 100k and 200k, so a spread of one readdir's names into push() is a
    // crash dressed as a size.
    const WIDTH = 200000;
    const names = [];
    for (let i = 0; i < WIDTH; i += 1) names.push(`f${i}`);
    const fs = {
      lstat: async (p) => (p === ROOT ? dir() : file(1)),
      readdir: async (p) => (p === ROOT ? names : []),
    };

    expect(await measureTree(ROOT, fs)).to.equal(WIDTH);
  });
});
