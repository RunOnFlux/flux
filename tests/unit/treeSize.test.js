const { expect } = require('chai');
const { measureTree, DEFAULT_BUDGET } = require('../../ZelBack/src/services/utils/treeSize');

describe('treeSize tests', () => {
  const ROOT = '/vol';

  const dir = () => ({ isDirectory: () => true, isFile: () => false });
  const file = (size) => ({ isDirectory: () => false, isFile: () => true, size });
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

  it('reports no figure at all once the budget runs out', async () => {
    // null, not a partial sum: a size that cannot be established is not a small
    // one, and every caller has to be able to tell the two apart.
    const names = Array.from({ length: DEFAULT_BUDGET + 100 }, (_, i) => `f${i}`);
    const fs = {
      lstat: async (p) => (p === ROOT ? dir() : file(1)),
      readdir: async () => names,
    };

    expect(await measureTree(ROOT, fs)).to.equal(null);
  });

  it('honours a smaller budget when one is given', async () => {
    const names = Array.from({ length: 50 }, (_, i) => `f${i}`);
    const fs = {
      lstat: async (p) => (p === ROOT ? dir() : file(1)),
      readdir: async () => names,
    };

    expect(await measureTree(ROOT, fs, 10)).to.equal(null);
    expect(await measureTree(ROOT, fs, 500)).to.equal(50);
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

  it('does not recurse, so a deep tree cannot overflow the stack', async () => {
    // 5000 levels: the previous implementation recursed once per level.
    const depth = 5000;
    const fs = {
      lstat: async (p) => (p.split('/').length - 1 < depth ? dir() : file(3)),
      readdir: async () => ['down'],
    };

    expect(await measureTree('/vol', fs, depth + 10)).to.equal(3);
  });
});
