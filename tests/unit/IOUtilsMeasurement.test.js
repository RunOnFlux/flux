const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

// Both of these measure something whose duration is set by how much data it was
// given, and both feed a restore that has already stopped the app and pulled the
// archive down. Their output is consumed as it arrives rather than collected, so
// what is asserted here is the reading taken from a real listing's shape - and,
// for the directory walk, that the LAST line is the answer, since du reports
// every directory it passes and only its final line is the total.
describe('IOUtils streamed measurement', () => {
  // GNU tar's verbose listing: permissions, owner/group, SIZE, date, time, name.
  const tarLine = (size, name) => `-rw-rw-r-- root/root ${size} 2026-08-11 13:22 ${name}`;

  // Drives the caller's onLine with the given lines, as the real one would.
  const streamer = (lines, result = {}) => sinon.stub().callsFake(async (cmd, options) => {
    lines.forEach((line) => options.onLine(line));
    return { error: null, stderr: '', ...result };
  });

  const load = (runStreamingCommand) => proxyquire('../../ZelBack/src/services/IOUtils', {
    './serviceHelper': { runStreamingCommand },
  });

  describe('inspectTarGz', () => {
    it('counts the members and totals the size column', async () => {
      const run = streamer([
        'drwxrwxr-x root/root 0 2026-08-11 13:22 data/',
        tarLine(4096, 'data/a.bin'),
        tarLine(1024, 'data/b.bin'),
      ]);
      const IOUtils = load(run);

      const result = await IOUtils.inspectTarGz('/backup/app.tar.gz');

      expect(run.calledOnce, 'the stub is actually wired in').to.equal(true);
      expect(result).to.deep.equal({ status: true, entries: 3, bytes: 5120 });
    });

    it('runs tar as argv with no shell, and bounds it by silence rather than by total time', async () => {
      const run = streamer([tarLine(1, 'data/a')]);
      const IOUtils = load(run);

      await IOUtils.inspectTarGz('/backup/app.tar.gz');

      const [cmd, options] = run.firstCall.args;
      expect(cmd, 'no shell - a path is an argument, never syntax').to.equal('tar');
      expect(options.params).to.deep.equal(['-tzvf', '/backup/app.tar.gz']);
      expect(options.idleTimeout, 'bounded by no progress').to.be.a('number').and.be.above(0);
      expect(options.timeout, 'never by a total clock - that only kills the big ones').to.equal(undefined);
    });

    it('refuses a listing whose size column is not where it expects', async () => {
      // A different tar's column layout: reporting its total as zero would walk
      // an unmeasured archive through the free-space check.
      const run = streamer(['-rw-rw-r-- 1 root root notasize data/a.bin']);
      const IOUtils = load(run);

      const result = await IOUtils.inspectTarGz('/backup/app.tar.gz');

      expect(result.status).to.equal(false);
      expect(result.error).to.equal('archive listing not in the expected format');
    });

    it('accepts an archive whose members are all genuinely empty', async () => {
      const run = streamer([tarLine(0, 'data/a'), tarLine(0, 'data/b')]);
      const IOUtils = load(run);

      const result = await IOUtils.inspectTarGz('/backup/app.tar.gz');

      expect(result).to.deep.equal({ status: true, entries: 2, bytes: 0 });
    });

    it('reports what the command said when it fails', async () => {
      const run = streamer([], { error: new Error('exited with code 2'), stderr: 'gzip: unexpected end of file\n' });
      const IOUtils = load(run);

      const result = await IOUtils.inspectTarGz('/backup/app.tar.gz');

      expect(result.status).to.equal(false);
      expect(result.error).to.equal('gzip: unexpected end of file');
    });
  });

  describe('getDirectorySizeBytes', () => {
    it('takes the total du reports last, not the first directory it walked', async () => {
      const run = streamer([
        '0\t/mnt/appdata/myapp/sub2',
        '4096\t/mnt/appdata/myapp/sub1',
        '208896\t/mnt/appdata/myapp',
      ]);
      const IOUtils = load(run);

      const bytes = await IOUtils.getDirectorySizeBytes('/mnt/appdata/myapp');

      expect(bytes).to.equal(208896);
    });

    it('walks with -b so the traversal is observable, and is bounded by silence', async () => {
      const run = streamer(['12\t/mnt/appdata/myapp']);
      const IOUtils = load(run);

      await IOUtils.getDirectorySizeBytes('/mnt/appdata/myapp');

      const [cmd, options] = run.firstCall.args;
      expect(cmd).to.equal('du');
      expect(options.params, '-s would report only at the end, leaving nothing to observe')
        .to.deep.equal(['-b', '/mnt/appdata/myapp']);
      expect(options.idleTimeout).to.be.a('number').and.be.above(0);
    });

    it('returns null when the walk fails', async () => {
      const run = streamer([], { error: new Error('exited with code 1'), stderr: 'du: cannot read directory\n' });
      const IOUtils = load(run);

      expect(await IOUtils.getDirectorySizeBytes('/mnt/appdata/myapp')).to.equal(null);
    });
  });
});
