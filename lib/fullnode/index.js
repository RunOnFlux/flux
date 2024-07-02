/* eslint-disable func-names */
/* eslint-disable no-param-reassign */
const fs = require('fs');
const nodePath = require('path');
const platform = require('os').platform();
const homedir = require('os').homedir();

function Config() {
  const coinpathwin = 'Zelcash';
  const coinpathlinux = 'zelcash';
  const coinpathmac = 'Zelcash';
  const newcoinpathwin = 'Flux';
  const newcoinpathlinux = 'flux';
  const newcoinpathmac = 'Flux';
  const confFile = 'zelcash.conf';
  const confFileNew = 'flux.conf';
  let confFilePath;
  let folderPath;
  if (platform === 'linux') {
    let pathLinux = nodePath.join(homedir, `.${coinpathlinux}`);
    const pathLinuxNew = nodePath.join(homedir, `.${newcoinpathlinux}`);
    if (fs.existsSync(pathLinuxNew)) {
      pathLinux = pathLinuxNew;
    }
    let confFilePathLinux = nodePath.join(pathLinux, confFile);
    const pathConfigLinuxNew = nodePath.join(pathLinux, confFileNew);
    if (fs.existsSync(pathConfigLinuxNew)) {
      confFilePathLinux = pathConfigLinuxNew;
    }
    confFilePath = confFilePathLinux;
    folderPath = pathLinux;
  } else if (platform === 'darwin') {
    let pathMac = nodePath.join(homedir, 'Library', 'Application Support', coinpathmac);
    const pathMacNew = nodePath.join(homedir, 'Library', 'Application Support', newcoinpathmac);
    if (fs.existsSync(pathMacNew)) {
      pathMac = pathMacNew;
    }
    let confFilePathMac = nodePath.join(pathMac, confFile);
    const pathConfigMacNew = nodePath.join(pathMac, confFileNew);
    if (fs.existsSync(pathConfigMacNew)) {
      confFilePathMac = pathConfigMacNew;
    }
    confFilePath = confFilePathMac;
    folderPath = pathMac;
  } else if (platform === 'win32') {
    let pathWindows = nodePath.join(process.env.APPDATA, coinpathwin);
    const pathWindowsNew = nodePath.join(process.env.APPDATA, newcoinpathwin);
    if (fs.existsSync(pathWindowsNew)) {
      pathWindows = pathWindowsNew;
    }
    let confFilePathWindows = nodePath.join(pathWindows, confFile);
    const pathConfigWindowsNew = nodePath.join(pathWindows, confFileNew);
    if (fs.existsSync(pathConfigWindowsNew)) {
      confFilePathWindows = pathConfigWindowsNew;
    }
    confFilePath = confFilePathWindows;
    folderPath = pathWindows;
  }

  this.defaultConfigPath = confFilePath;
  this.defaultFolderPath = folderPath;

  this.lines = fs.readFileSync(confFilePath, 'utf-8').split('\n').map((line) => line.trim());

  // Create a dictionary from keys and values
  this.keysvalues = this.lines.reduce((map, line) => {
    const [key, value] = line.split(/=(.*)/, 2);

    if (!key && !value) return map;

    if (!(key in map)) map[key] = value;
    else if (typeof map[key] === 'string') map[key] = [map[key], value];
    else map[key].push(value);

    return map;
  }, {});
}

Config.prototype.defaultFolder = function () {
  return this.defaultFolderPath;
};
Config.prototype.defaultConfig = function () {
  return this.defaultConfigPath;
};
Config.prototype.get = function (name) {
  return this.keysvalues[name];
};
Config.prototype.set = function (key, value, replace = false) {
  // strip whitespace?
  const map = this.keysvalues;
  if (replace || !(key in map)) map[key] = value;
  else if (typeof map[key] === 'string') map[key] = [map[key], value];
  else {
    const index = map[key].indexOf(value);
    if (index === -1) map[key].push(value);
  }
};
Config.prototype.write = function () {
  const lines = Object.entries(this.keysvalues).flatMap((entry) => {
    const [key, value] = entry;

    if (typeof value === 'string') return `${key}=${value}`;
    return value.map((item) => `${key}=${item}`);
  });

  const fileData = `${lines.join('\n')}\n`;
  fs.writeFileSync(this.defaultConfigPath, fileData);
};
Config.prototype.rpcuser = function () {
  return this.keysvalues.rpcuser;
};
Config.prototype.rpcpassword = function () {
  return this.keysvalues.rpcpassword;
};
Config.prototype.rpcport = function () {
  return this.keysvalues.rpcport;
};
module.exports = {
  Config,
};
