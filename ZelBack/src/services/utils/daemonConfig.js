const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

class DaemonConfig {
  static daemonPaths = {
    linux: {
      zelPath: '.zelcash',
      fluxPath: '.flux',
    },
    darwin: {
      zelPath: 'Zelcash',
      fluxPath: 'Flux',
    },
    win32: {
      zelPath: 'Zelcash',
      fluxPath: 'Flux',
    },
  };

  static confFileNames = {
    zelFile: 'zelcash.conf',
    fluxFile: 'flux.conf',
  };

  #resolveAttempted = false;

  platform = process.platform;

  homedir = os.homedir();

  absConfigPath = '';

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

  get resolveAttempted() {
    return this.#resolveAttempted;
  }

  get pathResolved() {
    return Boolean(this.absConfigPath);
  }

  get configPath() {
    return this.absConfigPath;
  }

  get configDir() {
    return this.absConfigPath ? path.dirname(this.absConfigPath) : null;
  }

  get rpcuser() {
    return this.configElements.rpcuser;
  }

  get rpcpassword() {
    return this.configElements.rpcpassword;
  }

  get rpcport() {
    return this.configElements.rpcport;
  }

  async resolvePaths() {
    this.#resolveAttempted = true;

    const { fluxPath, zelPath } = DaemonConfig.daemonPaths[this.platform];
    const { fluxFile, zelFile } = DaemonConfig.confFileNames;

    const fluxDir = path.join(this.baseDir, fluxPath, fluxFile);
    const zelDir = path.join(this.baseDir, zelPath, zelFile);

    const fluxExists = await fs.stat(fluxDir).catch(() => false);

    if (fluxExists) {
      this.absConfigPath = fluxDir;
      return;
    }

    const zelExists = await fs.stat(fluxDir).catch(() => false);

    if (zelExists) this.absConfigPath = zelDir;
  }

  async parseConfig() {
    if (!this.#resolveAttempted) await this.resolvePaths();

    if (!this.absConfigPath) return false;

    this.raw = await fs.readFile(this.absConfigPath, 'utf-8').catch(() => '');
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

    if (!this.absConfigPath) return false;

    const writePath = fileName ? path.join(this.configDir, fileName) : this.absConfigPath;

    const lines = Object.entries(this.configElements).flatMap((entry) => {
      const [key, value] = entry;

      if (typeof value === 'string') return `${key}=${value}`;
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

module.exports = {
  DaemonConfig,
};
