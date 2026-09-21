const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const { expect } = chai;

const GIB = 1024 ** 3;
const APPS_FOLDER = '/dat/var/lib/fluxos/flux-apps/';

function row(source, target, fstype, availGib, { used = 1, options = 'rw,relatime' } = {}) {
  return {
    source,
    target,
    fstype,
    options,
    readOnly: options.split(',').includes('ro'),
    sizeBytes: (availGib + used) * GIB,
    usedBytes: used * GIB,
    availableBytes: availGib * GIB,
    usePercent: 1,
  };
}

// The mount tables of the three node shapes the fleet actually runs, read off
// each with `findmnt --real --list`. A placement rule is only worth as much as
// the tables it was tried against, so these are recorded rather than invented.
const LEGACY_NODE = [
  row('/dev/sda2', '/', 'ext4', 138),
];

// A second Arcane node, different apps and different free space. Its root is an
// overlay, which `findmnt --real` omits, so an Arcane node offers no root mount
// at all - its loops are app volumes and nothing else.
const ARCANE_NODE_2 = [
  row('/dev/sda1', '/boot/efi', 'vfat', 1),
  row('/dev/mapper/os_crypt', '/mnt/root', 'ext4', 10, { used: 5 }),
  row('/dev/mapper/flux_crypt', '/dat', 'xfs', 783, { used: 80 }),
  row('/dev/loop2', '/dat/var/lib/fluxos/flux-apps/fluxFoldingAtHome_FoldingAtRunOnFlux30', 'ext4', 2),
  row('/dev/loop3', '/dat/var/lib/fluxos/flux-apps/fluxcloudgit_bannermaker', 'ext4', 10),
];

const ARCANE_NODE = [
  row('/dev/mapper/os_crypt', '/mnt/root', 'ext4', 10, { used: 6 }),
  row('/dev/sda1', '/boot/efi', 'vfat', 1),
  row('/dev/mapper/flux_crypt', '/dat', 'xfs', 744, { used: 125 }),
  row('/dev/loop2', '/dat/var/lib/fluxos/flux-apps/fluxgateway_cumulusvpngb', 'ext4', 5),
  row('/dev/loop3', '/dat/var/lib/fluxos/flux-apps/fluxwebdelta_webdelta', 'ext4', 17),
  row('/dev/loop4', '/dat/var/lib/fluxos/flux-apps/fluxkeycloak_keycloak', 'ext4', 1),
];

// FluxOS inside a container: docker binds three of its own files off the host
// disk, so one filesystem is reported four times and three of the four are
// files.
const CONTAINERISED_NODE = [
  row('/dev/sda2[/var/lib/docker/containers/abc/hostname]', '/etc/hostname', 'ext4', 1831),
  row('/dev/sda2[/var/lib/docker/containers/abc/hosts]', '/etc/hosts', 'ext4', 1831),
  row('/dev/sda2[/var/lib/docker/containers/abc/resolv.conf]', '/etc/resolv.conf', 'ext4', 1831),
  row('/dev/sda2[/var/lib/docker/volumes/appdata/_data]', '/mnt/appdata', 'ext4', 1831),
];

// One disk bound at two directories. The file binds above are dropped before
// deduplication ever runs, so only a table like this can say whether one disk
// is counted once.
const TWICE_BOUND_DISK = [
  row('/dev/sda2[/var/lib/docker/volumes/appdata/_data]', '/mnt/appdata', 'ext4', 1831),
  row('/dev/sda2[/var/lib/docker/volumes/extra/_data]', '/mnt/extra', 'ext4', 1831),
];

// A container whose root is a loop-mounted image, which is how LXC commonly
// presents one. The loop IS the host disk here, not an app's volume.
const LOOP_ROOTED_NODE = [
  row('/dev/loop0', '/', 'ext4', 400, { used: 30 }),
];

// An app volume mounted somewhere other than under the apps folder: still an
// app's disk, and still no place to put another app's image.
const STRAY_APP_VOLUME = [
  row('/dev/sda2', '/', 'ext4', 50),
  row('/dev/loop7', '/mnt/storage', 'ext4', 900),
];

// An app's volume that is not a loop: an operator can mount anything anywhere,
// and it is still an app's disk. Every other fixture's app volumes are loops,
// which the loop rule catches first, so only this one can say whether the apps
// folder is guarded in its own right.
const NON_LOOP_APP_VOLUME = [
  row('/dev/sda2', '/', 'ext4', 50),
  row('/dev/sdc1', '/dat/var/lib/fluxos/flux-apps/fluxbig_big', 'ext4', 900),
];

// An operator's network storage, roomier and emptier than anything local.
// `findmnt --real` lists it, and ranking by free space would otherwise offer it
// ahead of every disk the node owns.
const NETWORK_STORAGE = [
  row('/dev/sda2', '/', 'ext4', 100),
  row('nas:/export', '/mnt/nas', 'nfs4', 4000),
  row('//nas/media', '/mnt/media', 'cifs', 3000),
  row('hostshare', '/mnt/hostshare', 'virtiofs', 2000),
  // The cluster filesystems are the same answer as NFS: the bytes are on
  // somebody else's machine, however the mount is spelled.
  row('mds@tcp:/lustrefs', '/mnt/lustre', 'lustre', 5000),
  row('gpfsdev', '/mnt/gpfs', 'gpfs', 5000),
  row('beegfs_nodev', '/mnt/beegfs', 'beegfs', 5000),
];

// The same, mounted through fuse, which names the driver rather than the
// backing. Its own fixture: the named types and the fuse family are two rules,
// and either one broken has to fail a test of its own.
const FUSE_NETWORK_STORAGE = [
  row('/dev/sda2', '/', 'ext4', 100),
  row('gluster1:/vol0', '/mnt/gluster', 'fuse.glusterfs', 4000),
];

// A ZFS-rooted node whose docker uses the zfs storage driver: every container's
// root filesystem is its own dataset under docker's data directory, and every
// dataset reports the pool's free space, so ranking cannot tell them from a
// disk. An image placed in one lands inside another app's container.
const ZFS_DOCKER_GRAPH = [
  row('rpool/ROOT/node', '/', 'zfs', 50, { used: 40 }),
  // The disk an operator gave docker, and the emptiest thing here - so if it
  // were being refused, ranking would not hide it.
  row('/dev/sdb1', '/var/lib/docker', 'ext4', 838),
  row('rpool/docker/3f9c1e', '/var/lib/docker/zfs/graph/3f9c1e', 'zfs', 500),
  row('rpool/docker/a17b22', '/var/lib/docker/zfs/graph/a17b22', 'zfs', 500),
];

// A ZFS or btrfs root, which findmnt names by dataset and not under /dev.
const DATASET_ROOTED_NODE = [
  row('rpool/lxc/ct-101', '/', 'zfs', 900, { used: 40 }),
];

const FILES = new Set(['/etc/hostname', '/etc/hosts', '/etc/resolv.conf']);

describe('app volume placement', () => {
  let deviceHelperStub;
  let volumeService;

  beforeEach(() => {
    deviceHelperStub = { listMountedFilesystems: sinon.stub().resolves([]), listAllMounts: sinon.stub().resolves([]) };
    const statStub = sinon.stub().callsFake(async (target) => {
      if (FILES.has(target)) return { isDirectory: () => false };
      return { isDirectory: () => true };
    });

    volumeService = proxyquire('../../ZelBack/src/services/utils/volumeService', {
      '../dockerService': { getAppIdentifier: sinon.stub() },
      '../serviceHelper': { runCommand: sinon.stub().resolves({ error: null, stdout: '', stderr: '' }) },
      './mountParser': {},
      './appConstants': {
        appsFolder: APPS_FOLDER,
        appVolumesPath: '/dat/var/lib/fluxos/appvolumes',
        legacyAppVolumesPath: '/dat/var/lib/fluxosappvolumes',
        APP_VOLUME_MOUNT_OPTIONS: [],
      },
      '../../lib/log': {
        info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
      },
      '../deviceHelper': deviceHelperStub,
      fs: { promises: { stat: statStub } },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  // `allTable` is every mount the kernel holds, which decides what a write to a
  // candidate resolves through; it defaults to the block-backed table, the case
  // where nothing pseudo is stacked on anything.
  const placements = async (table, allTable = table) => {
    deviceHelperStub.listMountedFilesystems.resolves(table);
    deviceHelperStub.listAllMounts.resolves(allTable);
    return volumeService.placementVolumesInGib();
  };

  describe('the node shapes the fleet runs', () => {
    it('places on the only filesystem a legacy node has', async () => {
      const volumes = await placements(LEGACY_NODE);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    it('places on the data disk of an Arcane node, not its OS partition', async () => {
      const volumes = await placements(ARCANE_NODE);
      expect(volumes[0].mount).to.equal('/dat');
      // Kept as a candidate, but behind: it is a smaller disk, not an ineligible one.
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/dat', '/mnt/root']);
    });

    it('places on the data disk of a second Arcane node, whose apps and space differ', async () => {
      const volumes = await placements(ARCANE_NODE_2);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/dat', '/mnt/root']);
    });

    it('places on the data volume of a containerised node, never on a bound file', async () => {
      const volumes = await placements(CONTAINERISED_NODE);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/mnt/appdata']);
    });

    it('places on a loop-mounted root, which is the host disk', async () => {
      const volumes = await placements(LOOP_ROOTED_NODE);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    it('places on a dataset-named root, which carries no /dev device', async () => {
      const volumes = await placements(DATASET_ROOTED_NODE);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });
  });

  describe('what decides a candidate', () => {
    it('ranks the emptiest disk first, whatever order the mounts arrive in', async () => {
      const reversed = [...ARCANE_NODE].reverse();
      const volumes = await placements(reversed);
      expect(volumes[0].mount).to.equal('/dat');
    });

    it('refuses a mount that is a file', async () => {
      const volumes = await placements(CONTAINERISED_NODE);
      const mounts = volumes.map((v) => v.mount);
      expect(mounts).to.not.include('/etc/hostname');
      expect(mounts).to.not.include('/etc/hosts');
      expect(mounts).to.not.include('/etc/resolv.conf');
    });

    it('refuses a read-only mount', async () => {
      const volumes = await placements([
        row('/dev/sdb1', '/mnt/readonly', 'ext4', 900, { options: 'ro,relatime' }),
        row('/dev/sda2', '/', 'ext4', 100),
      ]);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    it("refuses another app's volume, which is what a mount under the apps folder is", async () => {
      const volumes = await placements(ARCANE_NODE);
      const mounts = volumes.map((v) => v.mount);
      expect(mounts.some((m) => m.startsWith('/dat/var/lib/fluxos/flux-apps/'))).to.equal(false);
    });

    it("refuses a loop mounted anywhere but the root, because that is an app's volume", async () => {
      const volumes = await placements(STRAY_APP_VOLUME);
      // The loop has by far the most room, so ranking alone would have taken it.
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    it("refuses a mount inside an app's directory even when it is not a loop", async () => {
      const volumes = await placements(NON_LOOP_APP_VOLUME);
      // It has the most room, so ranking alone would have taken it.
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    it('allows a disk the operator mounted at the apps folder itself', async () => {
      const volumes = await placements([
        row('/dev/sda2', '/', 'ext4', 20),
        row('/dev/sdb1', '/dat/var/lib/fluxos/flux-apps', 'ext4', 900),
      ]);
      expect(volumes[0].mount).to.equal('/dat/var/lib/fluxos/flux-apps');
    });

    it('refuses storage on another machine, however much room it has', async () => {
      const volumes = await placements(NETWORK_STORAGE);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    it('refuses network storage mounted through fuse, which names its driver', async () => {
      const volumes = await placements(FUSE_NETWORK_STORAGE);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    // The block-backed fuse form, which a real disk reaches a node under: an
    // NTFS or exFAT volume through ntfs-3g or exfat-fuse. The source is an
    // ordinary /dev/ node and the room is real, so nothing but the type says
    // no.
    it('refuses NTFS through either kernel driver', async () => {
      const volumes = await placements([
        row('/dev/sda2', '/', 'ext4', 50),
        row('/dev/sdb1', '/mnt/ntfs', 'ntfs', 900),
        row('/dev/sdc1', '/mnt/ntfs3', 'ntfs3', 800),
      ]);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    it('refuses a local disk mounted through fuse, which names no driver', async () => {
      const volumes = await placements([
        row('/dev/sda2', '/', 'ext4', 50),
        row('/dev/sdb1', '/mnt/external', 'fuseblk', 3000),
      ]);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    it('refuses a FAT filesystem, which can hold neither the image nor its permissions', async () => {
      const volumes = await placements([
        row('/dev/sda2', '/', 'ext4', 50),
        // An ESP outside /boot - systemd-boot's usual mount point. It has by
        // far the most room, so ranking alone would have taken it.
        row('/dev/sda1', '/efi', 'vfat', 900),
      ]);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    // Each name the family arrives under, and each survives `findmnt --real`.
    // exfat is the one the size argument does not reach: it has no 4 GiB cap,
    // and is refused for the ownership it cannot store.
    it('refuses every name the FAT family is reported under', async () => {
      const volumes = await placements([
        row('/dev/sda2', '/', 'ext4', 50),
        row('/dev/sdb1', '/mnt/exfat', 'exfat', 900),
        row('/dev/sdc1', '/mnt/msdos', 'msdos', 800),
      ]);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    // A write to a path goes through the mount stacked on top of it, so the
    // row underneath describes a filesystem the path no longer reaches. Both
    // of its answers are wrong there: whether the write succeeds, and how much
    // room it would find.
    it('refuses a disk another mount is stacked over, and offers the one on top', async () => {
      const volumes = await placements([
        row('/dev/sda2', '/', 'ext4', 50),
        row('/dev/sdb1', '/mnt/data', 'ext4', 900),
        row('/dev/sdc1', '/mnt/data', 'ext4', 20),
      ]);
      // by free space alone the shadowed 900 GiB row would have come first
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/', '/mnt/data']);
      expect(volumes.find((v) => v.mount === '/mnt/data').filesystem).to.equal('/dev/sdc1');
    });

    it('refuses a disk shadowed by a read-only mount, whatever its own flag says', async () => {
      const volumes = await placements([
        row('/dev/sda2', '/', 'ext4', 50),
        row('/dev/sdb1', '/mnt/data', 'ext4', 900),
        row('/dev/sdc1', '/mnt/data', 'ext4', 800, { options: 'ro,relatime' }),
      ]);
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    // The case `findmnt --real` cannot show: a pseudo filesystem laid over a
    // disk. The disk's row still reports its own free space, and a write to
    // that path lands in RAM - a volume the app loses at the next restart,
    // which is what the ephemeral rule exists to prevent.
    it('refuses a disk a pseudo filesystem is mounted over', async () => {
      const disk = row('/dev/sdb1', '/mnt/data', 'ext4', 900);
      const volumes = await placements(
        [row('/dev/sda2', '/', 'ext4', 50), disk],
        [
          { source: '/dev/sda2', target: '/', fstype: 'ext4' },
          { source: '/dev/sdb1', target: '/mnt/data', fstype: 'ext4' },
          { source: 'tmpfs', target: '/mnt/data', fstype: 'tmpfs' },
        ],
      );
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/']);
    });

    it("refuses a container runtime's own storage, whatever the filesystem says", async () => {
      const volumes = await placements(ZFS_DOCKER_GRAPH);
      // The container datasets are refused; the disk the operator gave docker
      // is not - that one is an ordinary disk mounted at an ordinary path, and
      // nothing a container owns can reach the root of it.
      expect(volumes.map((v) => v.mount)).to.deep.equal(['/var/lib/docker', '/']);
    });

    it('refuses the boot filesystem', async () => {
      const volumes = await placements(ARCANE_NODE);
      expect(volumes.map((v) => v.mount)).to.not.include('/boot/efi');
    });
  });

  describe('one disk counts once', () => {
    it('reports one disk bound at two directories a single time', async () => {
      const volumes = await placements(TWICE_BOUND_DISK);
      expect(volumes).to.have.lengthOf(1);
    });

    it('does not multiply free space by the number of binds', async () => {
      const volumes = await placements(TWICE_BOUND_DISK);
      const total = volumes.reduce((sum, v) => sum + v.available, 0);
      expect(total).to.equal(1831);
    });

    it('keeps genuinely separate disks apart', async () => {
      const volumes = await placements(ARCANE_NODE);
      const total = volumes.reduce((sum, v) => sum + v.available, 0);
      expect(total).to.equal(754);
    });
  });
});
