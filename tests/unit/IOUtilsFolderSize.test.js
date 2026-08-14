const { expect } = require('chai');
const proxyquire = require('proxyquire');

// getFolderSize measures volumes that APPS write to, from two paths that both
// run as the FluxOS process before any container exists: a copy's capacity
// check, and the file browser, which measures every directory it lists. So a
// symlink in one of those trees is attacker-supplied input to a privileged
// walk, and these are the cases that used to take the node down.
//
// Every stub here provides `stat` as well as `lstat`, and makes `stat` resolve
// links the way the real one does. That is deliberate: a stub with only lstat
// would make the previous implementation fail with "fs.stat is not a function"
// rather than by following the link, and a test that fails for the wrong reason
// proves nothing about the thing it names.
describe('IOUtils.getFolderSize tests', () => {
  const ROOT = '/mnt/appdata/flux-apps/fluxcomp_myapp';

  const dir = () => ({ isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false });
  const file = (size) => ({
    isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, size,
  });
  const link = () => ({ isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true });

  const load = (fsPromises) => proxyquire('../../ZelBack/src/services/IOUtils', {
    fs: { promises: fsPromises },
  });

  it('sums the files under a tree', async () => {
    const entries = { [ROOT]: dir(), [`${ROOT}/sub`]: dir() };
    const resolve = async (p) => entries[p] ?? file(100);
    const IOUtils = load({
      lstat: resolve,
      stat: resolve,
      readdir: async (p) => (p === ROOT ? ['a', 'sub'] : ['b']),
    });

    expect(await IOUtils.getFolderSize(ROOT)).to.equal(200);
  });

  it('answers a number for a tree it can only partly read', async () => {
    // It used to answer `false`, and the file browser put that straight into a
    // listing's `size` - a boolean where every sibling has a number, and NaN
    // for anything that then did arithmetic on it. A size is a number: a
    // directory that cannot be opened contributes what is known about it, and
    // the total is low rather than absent.
    const entries = { [ROOT]: dir(), [`${ROOT}/private`]: dir() };
    const IOUtils = load({
      lstat: async (p) => entries[p] ?? file(100),
      stat: async (p) => entries[p] ?? file(100),
      readdir: async (p) => {
        if (p === ROOT) return ['a', 'private'];
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    });

    const size = await IOUtils.getFolderSize(ROOT);

    expect(size).to.be.a('number');
    expect(size).to.equal(100);
  });

  it('counts a symlink to a directory as nothing, and does not follow it', async () => {
    // `stat` resolves the link to the directory behind it, which is what the
    // previous walk saw and descended into - so a link pointing outside the
    // volume measured whatever it found there.
    const behindTheLink = 1000;
    const IOUtils = load({
      lstat: async (p) => {
        if (p === ROOT) return dir();
        if (p === `${ROOT}/escape`) return link();
        return file(p.includes('secret') ? behindTheLink : 5);
      },
      stat: async (p) => {
        if (p === ROOT || p === `${ROOT}/escape`) return dir();
        return file(p.includes('secret') ? behindTheLink : 5);
      },
      readdir: async (p) => {
        if (p === ROOT) return ['escape', 'real'];
        return ['secret'];
      },
    });

    // 5, not 1005: the link contributes nothing and what it points at is never
    // reached.
    expect(await IOUtils.getFolderSize(ROOT)).to.equal(5);
  });

  it('terminates on a link pointing at its own parent', async () => {
    // `ln -s .. loop`, which an app can write into its own volume. With stat
    // this resolved to a directory and recursed until the process died.
    const IOUtils = load({
      lstat: async (p) => (p === ROOT ? dir() : link()),
      stat: async () => dir(),
      readdir: async () => ['loop'],
    });

    expect(await IOUtils.getFolderSize(ROOT)).to.equal(0);
  });

});
