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

    try {
      if (forceClean) {
        await this.git.clean(CleanOptions.FORCE + CleanOptions.RECURSIVE);
      }

      if (reset) {
        await this.git.reset(ResetMode.HARD);
      }

      await this.git.fetch(remote, branch);

      await this.git.checkout(branch);
    } catch {
      return false;
    }
    return true;
  }
}

async function main() {
  const repo = new FluxRepository();
  await repo.switchBranch('noexist');
}

if (require.main === module) {
  main();
}

module.exports = { FluxRepository };
