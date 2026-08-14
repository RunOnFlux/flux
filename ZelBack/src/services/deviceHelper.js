const serviceHelper = require('./serviceHelper');

/**
 * This is no longer required
 * @param {string} directory The mount source
 * @returns {Promise<string>} The mount target
 */
// async function getDfDevice(directory) {
//   const { stdout } = await serviceHelper.runCommand('df', {
//     params: ['--output=source,target', directory],
//   });

//   const lines = stdout.trim().split('\n');
//   for (let i = 1; i < lines.length; i += 1) {
//     const columns = lines[i].split(/\s+/);
//     if (columns[0] !== '') {
//       return columns[0];
//     }
//   }

//   return '';
// }

/**
 * Every mounted real (block-backed) filesystem with its byte-level usage.
 *
 * This is the `df` view, sourced from `findmnt --real --list`: one flat row per
 * mount, no mount-tree nesting. `--real` drops the pseudo filesystems
 * (proc/sysfs/cgroup/tmpfs); loop devices ARE real, so an app's loop-mounted
 * FLUXFSVOL appears here.
 *
 * Byte counts come from `--bytes`, so they need no unit conversion. The node-df
 * package this replaces reported `df -kP` blocks scaled by a multiplier table
 * that has no entry for bytes, and applied `precision` unconditionally - so the
 * call convention used across the file API produced NaN for size, used and
 * available, and the one that did not still returned KiB while asking for 'B'.
 *
 * Throws on findmnt failure rather than returning [], so a caller cannot read
 * "no disks" as "no space" and act on it.
 *
 * @returns {Promise<Array<{source: string, target: string, fstype: string,
 *   sizeBytes: number, usedBytes: number, availableBytes: number,
 *   usePercent: number}>>}
 */
async function listMountedFilesystems() {
  const res = await serviceHelper.runCommand('findmnt', {
    logError: false,
    params: ['--real', '--list', '--bytes', '--json', '--output', 'SOURCE,TARGET,FSTYPE,SIZE,USED,AVAIL,USE%'],
  });
  if (res.error) {
    throw new Error(`findmnt --real --list failed: ${res.error.message || res.error}`);
  }
  const filesystems = JSON.parse(res.stdout || '{}').filesystems || [];
  return filesystems.map((entry) => ({
    source: entry.source,
    target: entry.target,
    fstype: entry.fstype,
    sizeBytes: Number(entry.size),
    usedBytes: Number(entry.used),
    availableBytes: Number(entry.avail),
    usePercent: Number(String(entry['use%'] || '').replace('%', '')),
  }));
}

/**
 * Determines if mount target has a filesystem quota
 * @param {string} target The mount target
 * @returns {Promise<Boolean>} If the device has a quota
 */
async function hasQuotaOptionForMountTarget(target) {
  // this could just be reading and parsing /proc/self/mountinfo
  // then we don't need to use child process

  // As per `man mount`... use findmnt instead of mount:
  //   Listing the mounts
  //   The listing mode is maintained for backward compatibility only.

  //   For more robust and customizable output use findmnt(8), especially in your scripts. Note that control characters in the
  //   mountpoint name are replaced with '?'.

  //   here is a sample of what the output looks like: (I don't have xfs backed fs)

  // this was tested using:
  //   fallocate -l 100m pquotaFS
  //   mkfs.xfs pquotaFS
  //   mkdir pquotaFSMOUNT
  //   sudo mount -o pquota pquotaFS pquotaFSMOUNT

  //   davew@charlie:~$ findmnt --target /home/davew/pquotaFSMOUNT --options prjquota
  // TARGET                    SOURCE     FSTYPE OPTIONS
  // /home/davew/pquotaFSMOUNT /dev/loop7 xfs    rw,relatime,attr2,inode64,logbufs=8,logbsize=32k,prjquota

  // if there is no pquota, the above will return empty

  // output is parseable with --json option, but we don't need it here
  const { stdout } = await serviceHelper.runCommand('findmnt', { logError: false, params: ['--target', target, '--options', 'prjquota'] });

  return Boolean(stdout);
}

// For testing. Run: node <this file> /var/lib/docker (or another xfs target wth pquota)
if (require.main === module) {
  hasQuotaOptionForMountTarget(process.argv[2]).then((res) => console.log('Has quota:', res));
}

module.exports = {
  hasQuotaOptionForMountTarget,
  listMountedFilesystems,
};
