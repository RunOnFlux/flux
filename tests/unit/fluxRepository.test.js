const chai = require('chai');
chai.use(require('chai-as-promised'));

const { expect } = chai;

const sinon = require('sinon');

const os = require('node:os');
const sg = require('simple-git');

const { FluxRepository } = require('../../ZelBack/src/services/utils/fluxRepository');

describe('fluxRepository tests', () => {
  let getRemotesStub;
  let addRemoteStub;
  let branchStub;
  let fetchStub;
  let cleanStub;
  let resetStub;
  let revparseStub;
  let checkoutStub;
  let mergeStub;
  let gitStub;
  beforeEach(async () => {
    getRemotesStub = sinon.stub();
    addRemoteStub = sinon.stub();
    branchStub = sinon.stub();
    fetchStub = sinon.stub();
    cleanStub = sinon.stub();
    resetStub = sinon.stub();
    revparseStub = sinon.stub();
    checkoutStub = sinon.stub();
    mergeStub = sinon.stub();

    gitStub = sinon.stub(sg, 'simpleGit').returns({
      getRemotes: getRemotesStub,
      addRemote: addRemoteStub,
      branch: branchStub,
      fetch: fetchStub,
      clean: cleanStub,
      reset: resetStub,
      revparse: revparseStub,
      checkout: checkoutStub,
      merge: mergeStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should instantiate and create a git instance with correct properties', () => {
    const testOptions = {
      baseDir: '/testdir',
      binary: 'git',
      maxConcurrentProcesses: 6,
      trimmed: true,
    };

    expect(() => new FluxRepository({ repoDir: '/testdir' })).to.not.throw();

    sinon.assert.calledOnceWithExactly(gitStub, testOptions);
  });

  it('should instantiate and use default zelflux dir as baseDir', () => {
    sinon.stub(os, 'homedir').returns('/home/testfluxdir');

    const testOptions = {
      baseDir: '/home/testfluxdir/zelflux',
      binary: 'git',
      maxConcurrentProcesses: 6,
      trimmed: true,
    };

    expect(() => new FluxRepository()).to.not.throw();

    sinon.assert.calledOnceWithExactly(gitStub, testOptions);
  });

  it('should get git remotes in verbose mode', async () => {
    const expected = [
      {
        name: 'origin',
        refs: {
          fetch: 'https://github.com/RunOnFlux/flux.git',
          push: 'https://github.com/RunOnFlux/flux.git',
        },
      },
    ];

    getRemotesStub.resolves(expected);

    const repo = new FluxRepository({ repoDir: '/test' });
    const remotes = await repo.remotes();

    sinon.assert.calledOnceWithExactly(getRemotesStub, true);
    expect(remotes).to.deep.equal(expected);
  });

  it('should call the underlying addRemote with name and url', async () => {
    addRemoteStub.resolves();

    const repo = new FluxRepository({ repoDir: '/test' });
    await repo.addRemote('test_remote', 'https://blah.com');

    sinon.assert.calledOnceWithExactly(addRemoteStub, 'test_remote', 'https://blah.com');
  });

  it('should return the commit id of HEAD on the current branch', async () => {
    revparseStub.resolves('12345');

    const repo = new FluxRepository({ repoDir: '/test' });
    const id = await repo.currentCommitId();

    sinon.assert.calledOnceWithExactly(revparseStub, 'HEAD');
    expect(id).to.equal('12345');
  });

  it('should return the current branch', async () => {
    branchStub.resolves({
      all: [
        'master',
        'preprod',
        'remotes/origin/master',
        'remotes/origin/preprod',
      ],
      branches: {
        master: {
          current: false,
          linkedWorkTree: false,
          name: 'master',
          commit: '17f91ea',
          label: 'Check in new file (ahead of fork)',
        },
        preprod: {
          current: true,
          linkedWorkTree: false,
          name: 'preprod',
          commit: 'fb4f909',
          label: 'Update test_file',
        },
        'remotes/origin/master': {
          current: false,
          linkedWorkTree: false,
          name: 'remotes/origin/master',
          commit: '17f91ea',
          label: 'Check in new file (ahead of fork)',
        },
        'remotes/origin/preprod': {
          current: false,
          linkedWorkTree: false,
          name: 'remotes/origin/preprod',
          commit: 'fb4f909',
          label: 'Update test_file',
        },
      },
      current: 'preprod',
      detached: false,
    });

    const repo = new FluxRepository({ repoDir: '/test' });
    const branch = await repo.currentBranch();

    sinon.assert.calledOnce(branchStub);
    expect(branch).to.equal('preprod');
  });

  it('should call underlying git reset when resetToId called', async () => {
    resetStub.resolves();

    const expected = [sg.ResetMode.HARD, ['12345']];

    const repo = new FluxRepository({ repoDir: '/test' });
    await repo.resetToCommitId('12345');

    sinon.assert.calledWithExactly(resetStub, ...expected);
  });

  it('should track new remote when switchBranch called and it doesn\'t exist locally', async () => {
    fetchStub.resolves();
    // local branch doesn't exist
    revparseStub.rejects();
    checkoutStub.resolves();

    const repo = new FluxRepository({ repoDir: '/test' });
    await repo.switchBranch('test_branch');

    sinon.assert.notCalled(cleanStub);
    sinon.assert.notCalled(resetStub);
    sinon.assert.calledOnce(fetchStub);
    sinon.assert.calledOnce(revparseStub);
    sinon.assert.notCalled(mergeStub);
    sinon.assert.calledOnceWithExactly(checkoutStub, ['--track', 'origin/test_branch']);
  });

  it('should fetch, then switch to existing branch and fast-forward when switchBranch called and branch exists locally', async () => {
    fetchStub.resolves();
    // local branch does exist
    revparseStub.resolves('latest commit id here');
    checkoutStub.resolves();
    mergeStub.resolves();

    const repo = new FluxRepository({ repoDir: '/test' });
    await repo.switchBranch('test_branch');

    sinon.assert.notCalled(cleanStub);
    sinon.assert.notCalled(resetStub);
    sinon.assert.calledOnce(fetchStub);
    sinon.assert.calledOnce(revparseStub);
    sinon.assert.calledOnce(mergeStub);
    sinon.assert.calledOnceWithExactly(checkoutStub, 'test_branch');
  });

  it('should force clean local branch if clean requested on switchBranch', async () => {
    fetchStub.resolves();
    // local branch does exist
    revparseStub.resolves('latest commit id here');
    checkoutStub.resolves();
    mergeStub.resolves();
    cleanStub.resolves();

    const repo = new FluxRepository({ repoDir: '/test' });
    await repo.switchBranch('test_branch', { forceClean: true });

    sinon.assert.calledOnce(fetchStub);
    sinon.assert.calledOnce(cleanStub);
    sinon.assert.notCalled(resetStub);
    sinon.assert.calledOnce(revparseStub);
    sinon.assert.calledOnce(mergeStub);
    sinon.assert.calledOnceWithExactly(checkoutStub, 'test_branch');
  });

  it('should reset local branch if reset requested on switchBranch', async () => {
    fetchStub.resolves();
    // local branch does exist
    revparseStub.resolves('latest commit id here');
    checkoutStub.resolves();
    mergeStub.resolves();
    resetStub.resolves();

    const repo = new FluxRepository({ repoDir: '/test' });
    await repo.switchBranch('test_branch', { reset: true });

    sinon.assert.calledOnce(fetchStub);
    sinon.assert.notCalled(cleanStub);
    sinon.assert.calledOnce(resetStub);
    sinon.assert.calledOnce(revparseStub);
    sinon.assert.calledOnce(mergeStub);
    sinon.assert.calledOnceWithExactly(checkoutStub, 'test_branch');
  });
});
