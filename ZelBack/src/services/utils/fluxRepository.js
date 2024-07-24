const path = require('node:path');
const os = require('node:os');
const { simpleGit, CleanOptions, ResetMode } = require('simple-git');

class FluxRepository {
  defaultRepoDir = path.join(os.homedir(), 'zelflux');

  constructor(options = {}) {
    this.repoPath = options.repoDir || this.defaultRepoDir;

    const gitOptions = {
      baseDir: this.repoPath,
      binary: 'git',
      maxConcurrentProcesses: 6,
      trimmed: true,
    };

    this.git = simpleGit(gitOptions);
  }

  async remotes() {
    return this.git.getRemotes(true).catch(() => []);
  }

  async currentBranch() {
    const branches = await this.git.branch().catch(() => null);
    if (!branches) return null;

    const { current, detached } = branches;

    return detached ? null : current;
  }

  async switchBranch(branch, options = {}) {
    const forceClean = options.forceClean || false;
    const reset = options.reset || false;
    const remote = options.remote || 'origin';

    // fetch first incase there are errors.
    await this.git.fetch(remote, branch);

    if (forceClean) {
      await this.git.clean(CleanOptions.FORCE + CleanOptions.RECURSIVE);
    }

    if (reset) {
      await this.git.reset(ResetMode.HARD);
    }

    const exists = this.git.revparse(['--verify', branch]).catch(() => false);

    if (exists) {
      await this.git.checkout(branch);
      await this.git.merge(['--ff-only']);
      return;
    }

    await this.git.checkout(['--track', `${remote}/${branch}`]);
  }
}

module.exports = { FluxRepository };
