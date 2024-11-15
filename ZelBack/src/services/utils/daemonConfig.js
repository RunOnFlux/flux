const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

class DaemonConfig {
  static daemonConfigPaths = {
    linux: {
      zelPath: '.zelcash/zelcash.conf',
      fluxPath: '.flux/flux.conf',
    },
    darwin: {
      zelPath: 'Zelcash/zelcash.conf',
      fluxPath: 'Flux/flux.conf',
    },
    win32: {
      zelDir: 'Zelcash/zelcash.conf',
      fluxDir: 'Flux/flux.conf',
    },
  };

  #resolveAttempted = false;

  #absConfigPath = '';

  platform = process.platform;

  homedir = os.homedir();

  raw = '';

  configElements = {};

  constructor() {
    switch (this.platform) {
      case 'linux':
        this.baseDir = os.homedir();
        break;
      case 'darwin':
        this.baseDir = path.join(os.homedir(), 'Library/Application Support');
        break;
      case 'win32':
        this.baseDir = process.env.APPDATA;
        break;
      default:
        throw new Error('Unsupported platform');
    }
  }

  get unresolvable() {
    return this.#resolveAttempted && !this.#absConfigPath;
  }

  get resolveAttempted() {
    return this.#resolveAttempted;
  }

  get pathResolved() {
    return Boolean(this.#absConfigPath);
  }

  get configPath() {
    return this.#absConfigPath || null;
  }

  get configDir() {
    return this.#absConfigPath ? path.dirname(this.#absConfigPath) : null;
  }

  get rpcuser() {
    return this.configElements.rpcuser || null;
  }

  get rpcpassword() {
    return this.configElements.rpcpassword || null;
  }

  get rpcport() {
    return this.configElements.rpcport || null;
  }

  async resolvePaths() {
    this.#resolveAttempted = true;

    const { fluxPath, zelPath } = DaemonConfig.daemonConfigPaths[this.platform];

    const fluxConf = path.join(this.baseDir, fluxPath);
    const zelConf = path.join(this.baseDir, zelPath);

    const fluxExists = await fs.stat(fluxConf).catch(() => false);

    if (fluxExists) {
      this.#absConfigPath = fluxConf;
      return;
    }

    const zelExists = await fs.stat(zelConf).catch(() => false);

    if (zelExists) this.#absConfigPath = zelConf;
  }

  async parseConfig() {
    if (!this.#resolveAttempted) await this.resolvePaths();

    if (!this.#absConfigPath) return false;

    this.raw = await fs.readFile(this.#absConfigPath, 'utf-8').catch(() => '');
    const lines = this.raw.split('\n').map((line) => line.trim());

    this.configElements = lines.reduce((acc, line) => {
      const [key, value] = line.split(/=(.*)/, 2);

      if (!key && !value) return acc;

      const map = acc;

      if (!(key in map)) map[key] = value;
      else if (typeof map[key] === 'string') map[key] = [map[key], value];
      else map[key].push(value);

      return map;
    }, {});

    return true;
  }

  get(name) {
    return this.configElements[name];
  }

  set(key, value, replace = false) {
    const map = this.configElements;

    if (replace || !(key in map)) map[key] = value;
    else if (typeof map[key] === 'string') map[key] = [map[key], value];
    else {
      const index = map[key].indexOf(value);
      if (index === -1) map[key].push(value);
    }
  }

  async write(options = {}) {
    const fileName = options.fileName || null;

    if (!this.#absConfigPath) return false;

    const writePath = fileName ? path.join(this.configDir, fileName) : this.#absConfigPath;

    const lines = Object.entries(this.configElements).flatMap((entry) => {
      const [key, value] = entry;

      // a comment won't have a value, so we just return the comment as is
      if (typeof value === 'string') return `${key}=${value}`;
      if (typeof value === 'undefined') return key;
      return value.map((item) => `${key}=${item}`);
    });

    const fileData = `${lines.join('\n')}\n`;

    const ok = await fs
      .writeFile(writePath, fileData)
      .catch(() => false);

    return ok;
  }

  async createBackupConfig(name) {
    if (!this.raw) return false;

    const ok = await fs
      .writeFile(path.join(this.configDir, name), this.raw)
      .catch(() => false);

    return ok;
  }
}

async function main() {
  const dc = new DaemonConfig();
  const parsed = await dc.parseConfig();

  if (!parsed) return;

  await dc.write({ fileName: 'flux.conf.new' });
  console.log(dc.configElements);
}

if (require.main === module) {
  main();
}

module.exports = {
  DaemonConfig,
};
