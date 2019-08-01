function Config() {
  let conffile = 'zelcash.conf'
  const fs = require('fs')
  let homedir = require('os').homedir()
  let path = homedir + '/.zelcash/'

  if (fs.existsSync(path)) {
    conffile = path + conffile
  } else {
    throw new Error('Could not find zelcash configuration file!')
  }
  // Read all lines from config file, remove commented lines and empty lines.
  this.filteredlines = require('fs').readFileSync(conffile, 'utf-8').split('\n').filter(line => line.trim() && !line.trim().startsWith('#'))
  // Create a dictionary from keys and values
  // Maximum of 6 = signs can be in config line
  this.keysvalues = this.filteredlines.reduce(function (map, line) {
    let sp = line.split('=', 6)
    if (sp.length === 2) {
      map[sp[0].trim()] = sp[1].trim()
    } else if (sp.length === 3) {
      map[sp[0].trim()] = sp[1].trim() + '=' + sp[2].trim()
    } else if (sp.length === 4) {
      map[sp[0].trim()] = sp[1].trim() + '=' + sp[2].trim() + '=' + sp[3].trim()
    } else if (sp.length === 5) {
      map[sp[0].trim()] = sp[1].trim() + '=' + sp[2].trim() + '=' + sp[3].trim() + '=' + sp[4].trim()
    } else if (sp.length === 6) {
      map[sp[0].trim()] = sp[1].trim() + '=' + sp[2].trim() + '=' + sp[3].trim() + '=' + sp[4].trim() + '=' + sp[5].trim()
    }
    return map
  }, {})
}

Config.prototype.get = function (name) {
  return this.keysvalues[name]
}
Config.prototype.rpcuser = function () {
  return this.keysvalues['rpcuser']
}
Config.prototype.rpcpassword = function () {
  return this.keysvalues['rpcpassword']
}
Config.prototype.rpcport = function () {
  return this.keysvalues['rpcport'] || 16124
}

module.exports = {
  Config: Config
}
