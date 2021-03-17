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
  const newcoinpathlinux = 'zelcash';
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

  // Read all lines from config file, remove commented lines and empty lines.
  this.filteredlines = fs.readFileSync(confFilePath, 'utf-8').split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
  // Create a dictionary from keys and values
  // Maximum of 6 = signs can be in config line
  this.keysvalues = this.filteredlines.reduce((map, line) => {
    const sp = line.split('=', 6);
    if (sp.length === 2) {
      map[sp[0].trim()] = sp[1].trim();
    } else if (sp.length === 3) {
      map[sp[0].trim()] = `${sp[1].trim()}=${sp[2].trim()}`;
    } else if (sp.length === 4) {
      map[sp[0].trim()] = `${sp[1].trim()}=${sp[2].trim()}=${sp[3].trim()}`;
    } else if (sp.length === 5) {
      map[sp[0].trim()] = `${sp[1].trim()}=${sp[2].trim()}=${sp[3].trim()}=${sp[4].trim()}`;
    } else if (sp.length === 6) {
      map[sp[0].trim()] = `${sp[1].trim()}=${sp[2].trim()}=${sp[3].trim()}=${sp[4].trim()}=${sp[5].trim()}`;
    }
    return map;
  }, {});
}

Config.prototype.defaultFolder = () => this.defaultFolderPath;
Config.prototype.defaultConfig = () => this.defaultConfigPath;
Config.prototype.get = (name) => this.keysvalues[name];
Config.prototype.rpcuser = () => this.keysvalues.rpcuser;
Config.prototype.rpcpassword = () => this.keysvalues.rpcpassword;
Config.prototype.rpcport = (rpcport, testnetrpcport) => (this.get('testnet') === 1 ? testnetrpcport : rpcport); // no need for this

module.exports = {
  Config,
};
