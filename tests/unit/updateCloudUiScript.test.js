const { expect } = require('chai');
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '../../scripts/update-cloudui.sh');
const RELEASE_PATH = '/repos/RunOnFlux/fluxos-frontend/releases/latest';

// Runs the real script against a local server standing in for the GitHub API, in a
// throwaway project root, so what is exercised is the install on disk: where the build
// lands, what CloudUI points at, and what is left behind when a run fails or is killed.
// The script needs GNU mv and flock, so this runs on Linux only.
describe('update-cloudui.sh', function updateCloudUiScript() {
  this.timeout(30000);

  let server;
  let baseUrl;
  let bash;
  let root;
  let release;
  let releaseShape;
  let tarballHold;
  let releaseHold;
  let onTarballRequest;
  const holds = [];

  function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  // A release whose build is a dist/ folder, as fluxos-frontend publishes it, or with
  // its files at the top of the archive when flat.
  function makeRelease(label, { flat = false, paddingBytes = 0 } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudui-release-'));
    const build = flat ? dir : path.join(dir, 'dist');
    fs.mkdirSync(build, { recursive: true });
    fs.writeFileSync(path.join(build, 'index.html'), label);
    // random, so the archive is as large as the padding
    if (paddingBytes) fs.writeFileSync(path.join(build, 'padding.bin'), crypto.randomBytes(paddingBytes));
    fs.writeFileSync(path.join(build, 'stats.html'), 'stats');
    fs.writeFileSync(path.join(build, '_redirects'), 'redirects');
    const archive = path.join(os.tmpdir(), `cloudui-${crypto.randomBytes(6).toString('hex')}.tar.gz`);
    execFileSync('tar', ['-czf', archive, '-C', ...(flat ? [build, '.'] : [dir, 'dist'])]);
    const tarball = fs.readFileSync(archive);
    fs.rmSync(archive, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });

    return { label, tarball, sha: sha256(tarball) };
  }

  function releaseJson() {
    const asset = {
      name: 'dist.tar.gz',
      browser_download_url: `${baseUrl}/dist.tar.gz`,
      digest: `sha256:${releaseShape.digest ?? release.sha}`,
      size: release.tarball.length,
    };
    if (releaseShape.noAsset) asset.name = 'other.tar.gz';
    if (releaseShape.noDigest) delete asset.digest;
    if (releaseShape.noUrl) delete asset.browser_download_url;

    return JSON.stringify({
      tag_name: release.label,
      published_at: '2026-01-01T00:00:00Z',
      assets: [asset],
    }, null, 2);
  }

  async function handle(req, res) {
    if (req.url === RELEASE_PATH) {
      if (releaseShape.stallRelease) {
        const body = releaseJson();
        res.setHeader('Content-Length', body.length);
        res.write(body.slice(0, 10));
        holds.push(() => res.destroy());

        return;
      }
      if (releaseHold) {
        const { requested, answer } = releaseHold;
        releaseHold = null;
        requested();
        await answer;
      }
      if (releaseShape.unavailable) {
        res.statusCode = 503;
        res.end('{"message":"unavailable"}');

        return;
      }
      res.end(releaseJson());

      return;
    }
    if (req.url === '/dist.tar.gz') {
      const hold = tarballHold;
      tarballHold = null;
      if (onTarballRequest) onTarballRequest();
      if (hold) await hold;
      if (releaseShape.stallAfterBytes !== undefined) {
        res.setHeader('Content-Length', release.tarball.length);
        res.write(release.tarball.subarray(0, releaseShape.stallAfterBytes));
        holds.push(() => res.destroy());

        return;
      }
      if (releaseShape.dripBytesPerSecond) {
        await drip(res, release.tarball, releaseShape.dripBytesPerSecond);

        return;
      }
      res.end(release.tarball);

      return;
    }
    res.statusCode = 404;
    res.end();
  }

  // Sends the body in one-second steps of the given size.
  async function drip(res, body, bytesPerSecond) {
    res.setHeader('Content-Length', body.length);
    for (let offset = 0; offset < body.length; offset += bytesPerSecond) {
      res.write(body.subarray(offset, offset + bytesPerSecond));
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 1000); });
    }
    res.end();
  }

  // The script runs in its own process group, as it does under a service manager, so a
  // test can signal the whole group or only the script's shell.
  function runScript({ env = {}, args = [baseUrl] } = {}) {
    const child = spawn(bash, [path.join(root, 'scripts', 'update-cloudui.sh'), ...args], {
      env: { ...process.env, ...env },
      detached: true,
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const done = new Promise((resolve) => {
      child.on('close', (code, signal) => resolve({ code, signal, output }));
    });
    // A download the shell leaves running keeps its output open, so 'close' waits for it.
    const exited = new Promise((resolve) => { child.on('exit', resolve); });

    return { child, done, exited };
  }

  // The next tarball request is answered only when the returned answer() is called.
  function holdNextTarball() {
    let answer;
    tarballHold = new Promise((resolve) => { answer = resolve; });
    holds.push(answer);
    const requested = new Promise((resolve) => {
      onTarballRequest = () => {
        onTarballRequest = null;
        resolve();
      };
    });

    return { requested, answer };
  }

  // Sends the run's process group SIGTERM until the script exits, as a service manager
  // stopping it signals every process in it until no new ones appear.
  async function signalGroupUntilExit(run) {
    let exited = false;
    run.exited.then(() => { exited = true; });
    while (!exited) {
      try {
        process.kill(-run.child.pid, 'SIGTERM');
      } catch {
        // ESRCH: the group has gone
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 1); });
    }
  }

  // The next release lookup is answered only when the returned answer() is called.
  function holdNextRelease() {
    let answer;
    let requested;
    const answered = new Promise((resolve) => { answer = resolve; });
    holds.push(answer);
    const asked = new Promise((resolve) => { requested = resolve; });
    releaseHold = { requested, answer: answered };

    return { requested: asked, answer };
  }

  // A PATH entry whose readlink, the cleanup's first command, sends the run's process
  // group SIGTERM before it answers, as a service manager stopping the run would then.
  function readlinkThatStopsTheRun() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudui-readlink-'));
    const realReadlink = execFileSync('bash', ['-c', 'command -v readlink']).toString().trim();
    fs.writeFileSync(path.join(dir, 'readlink'), [
      '#!/bin/bash',
      'kill -TERM -- -"$(ps -o pgid= -p $$ | tr -d " ")"',
      'sleep 0.2',
      `exec ${realReadlink} "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });

    return { PATH: `${dir}:${process.env.PATH}` };
  }

  // A BASH_ENV whose DEBUG trap sends the script the given signal once, just before the
  // cleanup's first command, which is where a second signal during a service manager's stop
  // can land. A trap sees the interrupted command in BASH_COMMAND, so the cleanup is found
  // by name.
  function signalAtCleanup(signal) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudui-bashenv-'));
    const file = path.join(dir, 'env');
    const sent = path.join(dir, 'sent');
    fs.writeFileSync(file, [
      'signal_at_cleanup() {',
      `  if [ "\${FUNCNAME[1]}" = cleanup ] && [ ! -e ${sent} ]; then`,
      `    : > ${sent}`,
      `    kill -${signal} $$`,
      '  fi',
      '}',
      'set -o functrace',
      'trap signal_at_cleanup DEBUG',
      '',
    ].join('\n'));

    return { env: { BASH_ENV: file }, sent };
  }

  function within(ms, promise) {
    const timeout = new Promise((resolve) => { setTimeout(() => resolve('timed out'), ms); });

    return Promise.race([promise, timeout]);
  }

  // A PATH entry whose mv refuses --exchange, as mv before coreutils 9.5 does.
  function mvWithoutExchange() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudui-mv-'));
    const realMv = execFileSync('bash', ['-c', 'command -v mv']).toString().trim();
    fs.writeFileSync(path.join(dir, 'mv'), [
      '#!/bin/bash',
      'for a in "$@"; do',
      '  if [ "$a" = --exchange ]; then echo "mv: unrecognized option \'--exchange\'" >&2; exit 1; fi',
      'done',
      `exec ${realMv} "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });

    return { PATH: `${dir}:${process.env.PATH}` };
  }

  // A PATH entry whose curl measures the low-speed window in the given seconds instead of
  // the script's, so a stall is seen within a test. A curl run without --speed-time is
  // passed through unchanged, and so never gives up on a stalled transfer.
  function curlWithSpeedTime(seconds) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudui-curl-'));
    const realCurl = execFileSync('bash', ['-c', 'command -v curl']).toString().trim();
    fs.writeFileSync(path.join(dir, 'curl'), [
      '#!/bin/bash',
      'args=()',
      'prev=""',
      'for a in "$@"; do',
      `  if [ "$prev" = --speed-time ]; then a=${seconds}; fi`,
      '  args+=("$a")',
      '  prev="$a"',
      'done',
      `exec ${realCurl} "\${args[@]}"`,
      '',
    ].join('\n'), { mode: 0o755 });

    return { PATH: `${dir}:${process.env.PATH}` };
  }

  function mvHasExchange() {
    return execFileSync('mv', ['--help']).toString().includes('--exchange');
  }

  const cloudUi = () => path.join(root, 'CloudUI');
  const store = () => path.join(root, '.cloudui');
  const served = () => fs.readFileSync(path.join(cloudUi(), 'index.html'), 'utf8');
  const storeEntries = () => fs.readdirSync(store()).filter((name) => name !== '.lock').sort();
  const installedBuild = () => path.basename(fs.readlinkSync(cloudUi()));

  // CloudUI is a relative link into the store, and the store holds that build and
  // nothing else.
  function expectOnlyInstalledBuild() {
    expect(fs.lstatSync(cloudUi()).isSymbolicLink()).to.equal(true);
    expect(fs.readlinkSync(cloudUi())).to.equal(`.cloudui/${installedBuild()}`);
    expect(storeEntries()).to.deep.equal([installedBuild()]);
  }

  async function install(label, options = {}) {
    release = makeRelease(label, options);
    const result = await runScript(options).done;
    expect(result.code, result.output).to.equal(0);

    return result;
  }

  function makeCloudUiFolder() {
    fs.mkdirSync(cloudUi());
    fs.writeFileSync(path.join(cloudUi(), 'index.html'), 'old');
    fs.writeFileSync(path.join(cloudUi(), 'version'), 'old-sha');
  }

  before(async function startServer() {
    if (process.platform !== 'linux') this.skip();
    // by path, so a test can run the script with a PATH that has no bash on it
    bash = execFileSync('bash', ['-c', 'command -v bash']).toString().trim();
    server = http.createServer(handle);
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise((resolve) => { server.close(resolve); });
  });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudui-root-'));
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(SCRIPT, path.join(root, 'scripts', 'update-cloudui.sh'));
    releaseShape = {};
    tarballHold = null;
    releaseHold = null;
    onTarballRequest = null;
  });

  afterEach(() => {
    holds.splice(0).forEach((answer) => answer());
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('installing', () => {
    it('installs a build and points CloudUI at it when there is no CloudUI', async () => {
      const { output } = await install('v1');

      expect(output).to.include('Linked CloudUI to the new build');

      expect(served()).to.equal('v1');
      expect(fs.readFileSync(path.join(cloudUi(), 'version'), 'utf8').trim()).to.equal(release.sha);
      expect(fs.readFileSync(path.join(cloudUi(), 'tag'), 'utf8').trim()).to.equal('v1');
      expect(fs.existsSync(path.join(cloudUi(), 'stats.html'))).to.equal(false);
      expect(fs.existsSync(path.join(cloudUi(), '_redirects'))).to.equal(false);
      expectOnlyInstalledBuild();
    });

    it('installs a release whose files are at the top of the archive', async () => {
      await install('flat', { flat: true });

      expect(served()).to.equal('flat');
      expect(fs.readFileSync(path.join(cloudUi(), 'version'), 'utf8').trim()).to.equal(release.sha);
      expectOnlyInstalledBuild();
    });

    it('replaces a CloudUI folder with the link where mv has no --exchange', async () => {
      makeCloudUiFolder();

      const { output } = await install('v1', { env: mvWithoutExchange() });

      expect(output).to.include('Moved the CloudUI folder aside and linked the new build in its place');
      expect(served()).to.equal('v1');
      expectOnlyInstalledBuild();
    });

    it('swaps a CloudUI folder for the link with mv --exchange where mv has it', async function exchangeSwap() {
      if (!mvHasExchange()) this.skip();
      makeCloudUiFolder();

      const { output } = await install('v1');

      expect(output).to.include('Swapped the CloudUI folder for a link to the new build');
      expect(served()).to.equal('v1');
      expectOnlyInstalledBuild();
    });

    it('moves the link to the new build and removes the previous one', async () => {
      await install('v1');
      const first = installedBuild();

      const { output } = await install('v2');

      expect(output).to.include('Linked CloudUI to the new build');

      expect(served()).to.equal('v2');
      expect(fs.readFileSync(path.join(cloudUi(), 'tag'), 'utf8').trim()).to.equal('v2');
      expect(installedBuild()).to.not.equal(first);
      expectOnlyInstalledBuild();
    });

    it('moves the link with a rename where mv has no --exchange', async () => {
      await install('v1', { env: mvWithoutExchange() });

      const { output } = await install('v2', { env: mvWithoutExchange() });

      expect(output).to.include('Linked CloudUI to the new build');
      expect(served()).to.equal('v2');
      expectOnlyInstalledBuild();
    });

    it('reinstalls the release that is already installed into a new build', async () => {
      await install('v1');
      const first = installedBuild();

      const result = await runScript().done;

      expect(result.code, result.output).to.equal(0);
      expect(served()).to.equal('v1');
      expect(installedBuild()).to.not.equal(first);
      expectOnlyInstalledBuild();
    });

    it('replaces a CloudUI link whose build is gone', async () => {
      fs.symlinkSync('.cloudui/build.gone', cloudUi());

      await install('v1');

      expect(served()).to.equal('v1');
      expectOnlyInstalledBuild();
    });

    it('replaces a CloudUI link to a folder outside the store and leaves that folder alone', async () => {
      const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudui-elsewhere-'));
      fs.writeFileSync(path.join(elsewhere, 'index.html'), 'elsewhere');
      fs.symlinkSync(elsewhere, cloudUi());

      await install('v1');

      expect(served()).to.equal('v1');
      expectOnlyInstalledBuild();
      expect(fs.readFileSync(path.join(elsewhere, 'index.html'), 'utf8')).to.equal('elsewhere');
      fs.rmSync(elsewhere, { recursive: true, force: true });
    });
  });

  describe('a run that fails keeps the installed build and leaves nothing else', () => {
    const failures = [
      ['the release information cannot be fetched', { unavailable: true }],
      ['the release has no dist.tar.gz', { noAsset: true }],
      ['the asset has no download URL', { noUrl: true }],
      ['the asset has no digest', { noDigest: true }],
      ['the checksum does not match', { digest: '0'.repeat(64) }],
    ];

    failures.forEach(([when, shape]) => {
      it(`when ${when}`, async () => {
        await install('v1');
        const first = installedBuild();
        release = makeRelease('v2');
        releaseShape = shape;

        const result = await runScript().done;

        expect(result.code, result.output).to.equal(1);
        expect(served()).to.equal('v1');
        expect(installedBuild()).to.equal(first);
        expectOnlyInstalledBuild();
      });
    });

    it('when the archive does not unpack', async () => {
      await install('v1');
      const first = installedBuild();
      const tarball = crypto.randomBytes(1024);
      release = { label: 'broken', tarball, sha: sha256(tarball) };

      const result = await runScript().done;

      expect(result.code).to.not.equal(0);
      expect(served()).to.equal('v1');
      expect(installedBuild()).to.equal(first);
      expectOnlyInstalledBuild();
    });

    it('when a CloudUI folder is in place, it is left as it was', async () => {
      makeCloudUiFolder();
      release = makeRelease('v1');
      releaseShape = { digest: '0'.repeat(64) };

      const result = await runScript().done;

      expect(result.code).to.equal(1);
      expect(fs.lstatSync(cloudUi()).isDirectory()).to.equal(true);
      expect(served()).to.equal('old');
      expect(storeEntries()).to.deep.equal([]);
    });
  });

  describe('a slow or stalled download', () => {
    it('fails when the download stops moving, and keeps the installed build', async () => {
      await install('v1');
      const first = installedBuild();
      release = makeRelease('v2');
      releaseShape.stallAfterBytes = 100;

      const result = await within(20000, runScript({ env: curlWithSpeedTime(2) }).done);

      expect(result).to.not.equal('timed out');
      expect(result.code, result.output).to.not.equal(0);
      expect(served()).to.equal('v1');
      expect(installedBuild()).to.equal(first);
      expectOnlyInstalledBuild();
    });

    it('fails when the release information stops moving, and keeps the installed build', async () => {
      await install('v1');
      const first = installedBuild();
      release = makeRelease('v2');
      releaseShape.stallRelease = true;

      const result = await within(20000, runScript({ env: curlWithSpeedTime(2) }).done);

      expect(result).to.not.equal('timed out');
      expect(result.code, result.output).to.not.equal(0);
      expect(installedBuild()).to.equal(first);
      expectOnlyInstalledBuild();
    });

    it('installs a download that is slow but keeps moving, however long it takes', async () => {
      release = makeRelease('slow', { paddingBytes: 10000 });
      releaseShape.dripBytesPerSecond = 2500;
      const started = Date.now();

      const result = await runScript({ env: curlWithSpeedTime(2) }).done;

      expect(result.code, result.output).to.equal(0);
      expect(Date.now() - started).to.be.above(3000);
      expect(served()).to.equal('slow');
      expectOnlyInstalledBuild();
    });
  });

  describe('refusing to start', () => {
    it('creates nothing when no API base URL is given', async () => {
      const result = await runScript({ args: [] }).done;

      expect(result.code).to.equal(1);
      expect(fs.existsSync(store())).to.equal(false);
      expect(fs.existsSync(cloudUi())).to.equal(false);
    });

    it('creates nothing when flock is not installed', async () => {
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudui-bin-'));
      ['dirname', 'curl', 'sha256sum'].forEach((tool) => {
        const real = execFileSync('bash', ['-c', `command -v ${tool}`]).toString().trim();
        fs.symlinkSync(real, path.join(bin, tool));
      });

      const result = await runScript({ env: { PATH: bin } }).done;
      fs.rmSync(bin, { recursive: true, force: true });

      expect(result.code).to.equal(1);
      expect(result.output).to.include('flock is required');
      expect(fs.existsSync(store())).to.equal(false);
    });
  });

  describe('a run that is stopped or killed', () => {
    it('leaves only the installed build when its process group is stopped mid-download', async () => {
      await install('v1');
      const first = installedBuild();
      release = makeRelease('v2');
      const { requested } = holdNextTarball();

      const run = runScript();
      await requested;
      expect(storeEntries().some((name) => name.startsWith('work.'))).to.equal(true);
      process.kill(-run.child.pid, 'SIGTERM');
      await run.done;

      expect(served()).to.equal('v1');
      expect(installedBuild()).to.equal(first);
      expectOnlyInstalledBuild();
    });

    it('leaves only the installed build when its process group is signalled until it exits, as a service manager does', async () => {
      await install('v1');
      const first = installedBuild();
      release = makeRelease('v2');
      const { requested } = holdNextTarball();

      const run = runScript();
      await requested;
      await signalGroupUntilExit(run);
      await run.done;

      expect(served()).to.equal('v1');
      expect(installedBuild()).to.equal(first);
      expectOnlyInstalledBuild();
    });

    it('leaves only the installed build when its process group is sent SIGTERM twice at once', async () => {
      await install('v1');
      const first = installedBuild();
      release = makeRelease('v2');
      const { requested } = holdNextTarball();

      const run = runScript();
      await requested;
      process.kill(-run.child.pid, 'SIGTERM');
      process.kill(-run.child.pid, 'SIGTERM');
      await run.done;

      expect(served()).to.equal('v1');
      expect(installedBuild()).to.equal(first);
      expectOnlyInstalledBuild();
    });

    it('leaves only the installed build when the reader of its output has gone before it is stopped', async () => {
      await install('v1');
      const first = installedBuild();
      release = makeRelease('v2');
      const { requested } = holdNextTarball();

      const run = runScript();
      await requested;
      run.child.stdout.destroy();
      run.child.stderr.destroy();
      await signalGroupUntilExit(run);

      expect(served()).to.equal('v1');
      expect(installedBuild()).to.equal(first);
      expectOnlyInstalledBuild();
    });

    ['TERM', 'PIPE'].forEach((signal) => {
      it(`leaves only the installed build when a stopped run gets SIG${signal} as the cleanup starts`, async () => {
        await install('v1');
        const first = installedBuild();
        release = makeRelease('v2');
        const { requested } = holdNextTarball();
        const second = signalAtCleanup(signal);

        const run = runScript({ env: second.env });
        await requested;
        process.kill(-run.child.pid, 'SIGTERM');
        await run.done;

        expect(fs.existsSync(second.sent), `SIG${signal} was sent`).to.equal(true);
        expect(served()).to.equal('v1');
        expect(installedBuild()).to.equal(first);
        expectOnlyInstalledBuild();
      });
    });

    it('leaves only the installed build when a run that failed is stopped while it cleans up', async () => {
      await install('v1');
      const first = installedBuild();
      release = makeRelease('v2');
      releaseShape.digest = '0'.repeat(64);

      const result = await runScript({ env: readlinkThatStopsTheRun() }).done;

      expect(result.code).to.not.equal(0);
      expect(installedBuild()).to.equal(first);
      expectOnlyInstalledBuild();
    });

    it('leaves only the installed build when it writes after the reader of its output has gone', async () => {
      await install('v1');
      const first = installedBuild();
      release = makeRelease('v2');
      const { requested, answer } = holdNextRelease();

      const run = runScript();
      await requested;
      run.child.stdout.destroy();
      run.child.stderr.destroy();
      answer();
      const result = await run.exited.then((code) => code);

      expect(result).to.not.equal(0);
      expect(installedBuild()).to.equal(first);
      expectOnlyInstalledBuild();
    });

    it('leaves its download behind when killed outright, and the next run removes it', async () => {
      await install('v1');
      const first = installedBuild();
      release = makeRelease('v2');
      const { requested } = holdNextTarball();

      const run = runScript();
      await requested;
      process.kill(-run.child.pid, 'SIGKILL');
      await run.done;

      expect(served()).to.equal('v1');
      expect(installedBuild()).to.equal(first);
      expect(storeEntries().filter((name) => name.startsWith('work.'))).to.have.lengthOf(1);

      await install('v2');

      expect(served()).to.equal('v2');
      expectOnlyInstalledBuild();
    });

    it('removes everything an earlier run left in the store', async () => {
      await install('v1');
      fs.mkdirSync(path.join(store(), 'work.aaaaaa'));
      fs.writeFileSync(path.join(store(), 'work.aaaaaa', 'dist.tar.gz'), 'partial');
      fs.mkdirSync(path.join(store(), 'build.bbbbbb'));
      fs.symlinkSync('.cloudui/build.gone', path.join(store(), 'link.cccccc'));
      fs.mkdirSync(path.join(store(), 'previous.dddddd'));

      await install('v2');

      expect(served()).to.equal('v2');
      expectOnlyInstalledBuild();
    });

    it('installs when an earlier run was killed between moving the CloudUI folder aside and linking', async () => {
      fs.mkdirSync(store());
      fs.mkdirSync(path.join(store(), 'previous.aaaaaa'));
      fs.writeFileSync(path.join(store(), 'previous.aaaaaa', 'index.html'), 'old');
      fs.mkdirSync(path.join(store(), 'build.aaaaaa'));
      fs.symlinkSync('.cloudui/build.aaaaaa', path.join(store(), 'link.aaaaaa'));

      await install('v1');

      expect(served()).to.equal('v1');
      expectOnlyInstalledBuild();
    });

    it('does not hold the lock through a download that outlives its killed shell', async () => {
      await install('v1');
      release = makeRelease('v2');
      const { requested } = holdNextTarball();

      const orphaning = runScript();
      await requested;
      process.kill(orphaning.child.pid, 'SIGKILL');
      await orphaning.exited;

      const next = await within(10000, runScript().done);

      expect(next).to.not.equal('timed out');
      expect(next.code, next.output).to.equal(0);
      expect(served()).to.equal('v2');
    });
  });

  describe('two runs at once', () => {
    it('runs them one after the other, so neither removes the other\'s download', async () => {
      release = makeRelease('v1');
      const { requested, answer } = holdNextTarball();

      const first = runScript();
      await requested;
      const second = runScript();
      await new Promise((resolve) => { setTimeout(resolve, 500); });
      answer();
      const results = await Promise.all([first.done, second.done]);

      expect(results[0].code, results[0].output).to.equal(0);
      expect(results[1].code, results[1].output).to.equal(0);
      expect(served()).to.equal('v1');
      expectOnlyInstalledBuild();
    });
  });
});
