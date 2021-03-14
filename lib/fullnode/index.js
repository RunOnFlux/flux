function Config() {
  const fs = require('fs');
  const nodePath = require('path');
  const platform = require('os').platform()
  const homedir = require('os').homedir()
  const coinpathwin = "Zelcash";
  const coinpathlinux = "zelcash";
  const coinpathmac = "Zelcash";
  const newcoinpathwin = "Flux";
  const newcoinpathlinux = "zelcash";
  const newcoinpathmac = "Flux";
  const confFile = 'zelcash.conf';
  const confFileNew = 'flux.conf';
  let pathMac = nodePath.join(homedir, "Library", "Application Support", coinpathmac);
  let pathLinux = nodePath.join(homedir, `.${coinpathlinux}`);
  let pathWindows = nodePath.join(process.env.APPDATA, coinpathwin);
  if (newcoinpathmac) {
    const pathMacNew = nodePath.join(homedir, "Library", "Application Support", newcoinpathmac);
    if (fs.existsSync(pathMacNew)) {
      pathMac = pathMacNew;
    }
  }
  if (newcoinpathlinux) {
    const pathLinuxNew = nodePath.join(homedir, `.${newcoinpathlinux}`);
    if (fs.existsSync(pathLinuxNew)) {
      pathLinux = pathLinuxNew;
    }

  }
  if (newcoinpathwin) {
    const pathWindowsNew = nodePath.join(process.env.APPDATA, newcoinpathwin);
    if (fs.existsSync(pathWindowsNew)) {
      pathWindows = pathWindowsNew;
    }
  }

  let confFilePathMac = nodePath.join(pathMac, confFile);
  let confFilePathLinux = nodePath.join(pathLinux, confFile);
  let confFilePathWindows = nodePath.join(pathWindows, confFile);

  const pathConfigMacNew = nodePath.join(pathMac, confFileNew);
  const pathConfigLinuxNew = nodePath.join(pathLinux, confFileNew);
  const pathConfigWindowsNew = nodePath.join(pathWindows, confFileNew);
  if (fs.existsSync(pathConfigMacNew)) {
    confFilePathMac = pathConfigMacNew;
  }
  if (fs.existsSync(pathConfigLinuxNew)) {
    confFilePathLinux = pathConfigLinuxNew;
  }
  if (fs.existsSync(pathConfigWindowsNew)) {
    confFilePathWindows = pathConfigWindowsNew;
  }

  let confFilePath = confFilePathLinux;
  let folderPath = pathLinux;
  if (platform == "win32") {
    confFilePath = confFilePathWindows;
    folderPath = pathWindows;
  } else if (platform === "darwin") {
    confFilePath = confFilePathMac;
    folderPath = pathMac;
  }

  self.defaultConfigPath = confFilePath;
  self.defaultFolderPath = folderPath;

  // Read all lines from config file, remove commented lines and empty lines.
  self.filteredlines = fs.readFileSync(confFilePath, 'utf-8').split('\n').filter(line => line.trim() && !line.trim().startsWith('#'))
  // Create a dictionary from keys and values
  // Maximum of 6 = signs can be in config line
  self.keysvalues = self.filteredlines.reduce(function (map, line) {
    var sp = line.split('=', 6)
    if (sp.length == 2) {
      map[sp[0].trim()] = sp[1].trim();
    } else if (sp.length == 3) {
      map[sp[0].trim()] = sp[1].trim() + "=" + sp[2].trim();
    } else if (sp.length == 4) {
      map[sp[0].trim()] = sp[1].trim() + "=" + sp[2].trim() + "=" + sp[3].trim();
    } else if (sp.length == 5) {
      map[sp[0].trim()] = sp[1].trim() + "=" + sp[2].trim() + "=" + sp[3].trim() + "=" + sp[4].trim();
    } else if (sp.length == 6) {
      map[sp[0].trim()] = sp[1].trim() + "=" + sp[2].trim() + "=" + sp[3].trim() + "=" + sp[4].trim() + "=" + sp[5].trim();
    }
    return map;
  }, {});
}

Config.prototype.defaultFolder = function () {
  return self.defaultFolderPath;
};
Config.prototype.defaultConfig = function () {
  return self.defaultConfigPath;
};
Config.prototype.get = function (name) {
  return self.keysvalues[name]
};
Config.prototype.rpcuser = function () {
  return self.keysvalues['rpcuser']
};
Config.prototype.rpcpassword = function () {
  return self.keysvalues['rpcpassword']
};
Config.prototype.rpcport = function (rpcport, testnetrpcport) {
  return this.get('testnet') == 1 ? testnetrpcport : rpcport // no need for this
};

module.exports = {
  Config: Config
}
