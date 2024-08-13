const chai = require('chai');
chai.use(require('chai-as-promised'));

const { expect } = chai;

const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');

const { simpleGit } = require('simple-git');

const { FluxRepository } = require('../../ZelBack/src/services/utils/fluxRepository');

describe('Flux preprod branch tests', () => {
  const repoName = 'flux-integration';
  const testRepoName = `${repoName}-test`;

  let testDir;
  let repoDir;
  let testRepoDir;

  before(async () => {
    testDir = os.tmpdir();
    repoDir = path.join(testDir, repoName);
    testRepoDir = path.join(testDir, testRepoName);

    await fs.mkdir(repoDir);

    console.log('Cloning test repository');
    const git = simpleGit();
    await git.clone('https://github.com/RunOnFlux/flux-integration.git', repoDir);
  });

  beforeEach(async () => {
    await fs.cp(repoDir, testRepoDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testRepoDir, { recursive: true, force: true });
  });

  after(async () => {
    console.log('Deleting test repository');
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it('should return the correct branch as current branch', async () => {
    const repo = new FluxRepository({ repoDir: testRepoDir });
    const branch = await repo.currentBranch();
    expect(branch).to.equal('master');
  });

  it('should list remote branches', async () => {
    const repo = new FluxRepository({ repoDir: testRepoDir });
    const expected = [
      {
        name: 'origin',
        refs: {
          fetch: 'https://github.com/RunOnFlux/flux-integration.git',
          push: 'https://github.com/RunOnFlux/flux-integration.git',
        },
      },
    ];
    const remotes = await repo.remotes();
    expect(remotes).to.deep.equal(expected);
  });

  it('should switch branches if local is up to date with remote', async () => {
    const repo = new FluxRepository({ repoDir: testRepoDir });
    await expect(repo.switchBranch('preprod')).to.be.fulfilled;
    const branch = await repo.currentBranch();
    expect(branch).to.equal('preprod');
  });

  it('should switch branches if local has untracked work', async () => {
    const testFile = path.join(testRepoDir, 'untracked-file');
    await fs.writeFile(testFile, 'test content');

    const repo = new FluxRepository({ repoDir: testRepoDir });
    await expect(repo.switchBranch('preprod')).to.be.fulfilled;
    const branch = await repo.currentBranch();
    expect(branch).to.equal('preprod');

    const fileExists = Boolean(await fs.stat(testFile).catch(() => false));
    expect(fileExists).to.equal(true);
  });

  it('should switch branches and remove untracked if local has untracked work', async () => {
    const testFile = path.join(testRepoDir, 'untracked-file');
    await fs.writeFile(testFile, 'test content');

    const repo = new FluxRepository({ repoDir: testRepoDir });
    await expect(repo.switchBranch('preprod', { forceClean: true })).to.be.fulfilled;
    const branch = await repo.currentBranch();
    expect(branch).to.equal('preprod');

    const fileExists = Boolean(await fs.stat(testFile).catch(() => false));
    expect(fileExists).to.equal(false);
  });

  it('should reset current branch and allow switch where local work would be overwritten', async () => {
    const testFile = path.join(testRepoDir, 'README.md');
    await fs.writeFile(testFile, 'this file has been modified and would be overwritten on switch');

    const repo = new FluxRepository({ repoDir: testRepoDir });
    await expect(repo.switchBranch('preprod', { reset: true })).to.be.fulfilled;
    const branch = await repo.currentBranch();
    expect(branch).to.equal('preprod');
  });

  it('should sync local branch to remote if switching to existing branch', async () => {
    // setup
    const priorCommit = '815f77059ce7f968d259af1333b04f2f6d2cab6f';
    const repo = new FluxRepository({ repoDir: testRepoDir });
    await repo.switchBranch('preprod');
    const latestCommit = await repo.currentCommitId();
    await repo.resetToCommitId(priorCommit);
    const testCommit = await repo.currentCommitId();

    // test
    expect(testCommit).to.equal(priorCommit);
    await repo.switchBranch('master');

    await repo.switchBranch('preprod');
    const currentCommit = await repo.currentCommitId();

    expect(currentCommit).to.equal(latestCommit);
  });

  it('should switch to correct branch if multiple remotes', async () => {
    // setup
    const repoUrl = 'https://github.com/RunOnFlux/flux-integration.git';
    const forkUrl = 'https://github.com/RunOnFlux/flux-integration-fork.git';
    const latestCommit = 'fb4f9097d8b0bc19d0fb901238a4643e72b69398';

    const repo = new FluxRepository({ repoDir: testRepoDir });
    await repo.addRemote('test_remote', forkUrl);

    // test
    const remotes = await repo.remotes();
    const remote = remotes.find(
      (r) => r.refs.fetch === repoUrl,
    );

    await repo.switchBranch('preprod', { remote: remote.name });

    const currentCommit = await repo.currentCommitId();

    expect(currentCommit).to.equal(latestCommit);
  });
});
