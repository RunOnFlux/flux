const path = require('node:path');
const os = require('node:os');
const sg = require('simple-git');

class FluxRepository {
  // this may not exist
  defaultRepoDir = path.join(os.homedir(), 'zelflux');

  constructor(options = {}) {
    this.repoPath = options.repoDir || this.defaultRepoDir;

    const gitOptions = {
      baseDir: this.repoPath,
      binary: 'git',
      maxConcurrentProcesses: 6,
      trimmed: true,
    };

    this.git = sg.simpleGit(gitOptions);
  }

  async remotes() {
    return this.git.getRemotes(true).catch(() => []);
  }

  async addRemote(name, url) {
    await this.git.addRemote(name, url).catch(() => { });
  }

  async currentCommitId() {
    const id = await this.git.revparse('HEAD').catch(() => null);
    return id;
  }

  async currentBranch() {
    const branches = await this.git.branch().catch(() => null);
    if (!branches) return null;

    const { current, detached } = branches;

    return detached ? null : current;
  }

  async resetToCommitId(id) {
    await this.git.reset(sg.ResetMode.HARD, [id]).catch(() => { });
  }

  async switchBranch(branch, options = {}) {
    const forceClean = options.forceClean || false;
    const reset = options.reset || false;
    const remote = options.remote || 'origin';

    // fetch first incase there are errors.
    await this.git.fetch(remote, branch);

    if (forceClean) {
      await this.git.clean(sg.CleanOptions.FORCE + sg.CleanOptions.RECURSIVE);
    }

    if (reset) {
      await this.git.reset(sg.ResetMode.HARD);
    }

    const exists = await this.git.revparse(['--verify', branch]).catch(() => false);

    if (exists) {
      await this.git.checkout(branch);
      // don't think we need to reset here
      await this.git.merge(['--ff-only']);
      return;
    }

    await this.git.checkout(['--track', `${remote}/${branch}`]);
  }
}

module.exports = { FluxRepository };
