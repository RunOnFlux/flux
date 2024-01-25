const path = require('node:path');
const { writeFile, readFile } = require('node:fs/promises');

const log = require('../lib/log');
const generalService = require('./generalService');
const upnpService = require('./upnpService');

const { FluxGossipServer, logController: fpcLogController } = require('@megachips/fluxport-controller');
const { executeCall: executeBenchmarkCall } = require('./benchmarkService');

let apiPort = null;
let routerIp = null;
let outPoint = null;
let gossipServer = null;

async function getApiPort() {
  return new Promise((resolve, reject) => {
    if (apiPort) resolve(apiPort);

    if (!(gossipServer)) reject(new Error('gossipServer not ready'));

    gossipServer.once('portConfirmed', (port) => resolve(port));
  });
}

function getRouterIp() {
  return new Promise((resolve, reject) => {
    if (routerIp) resolve(routerIp);

    if (!(gossipServer)) reject(new Error('gossipServer not ready'));

    gossipServer.once('routerIpConfirmed', (ip) => resolve(ip));
  });
}

function stopGossipServer() {
  gossipServer.stop();
  gossipServer = null;
}

async function startGossipServer() {
  if (gossipServer) return gossipServer;

  log.info('Starting GossipServer');

  const logPath = path.join(userconfig.computed.appRootPath, 'debug.log');
  fpcLogController.addLoggerTransport('file', { logLevel: 'info', filePath: logPath });

  try {
    // this is reliant on fluxd running
    const res = await generalService.obtainNodeCollateralInformation();
    // const res = { txhash: "txtest", txindex: 0 }
    outPoint = { txhash: res.txhash, outidx: res.txindex };
  } catch {
    log.error('Error getting collateral info from daemon.');
    return null;
  }

  if (!(await upnpService.ufwAllowSsdpforInit())) {
    log.error('Error adjusting firewallfor SSDP.');
    return null;
  }

  // Using the port 16197 is fine here, even if in use. Flux uses TCP
  // whereas this uses UDP. Also, the gossipServer doesn't bind to the interface
  // address, only the multicast address so you won't get EADDRINUSE. Its good as
  // Flux already opens this port.
  gossipServer = new FluxGossipServer(outPoint, {
    // seems as good as any multicast address
    multicastGroup: '239.19.38.57',
    port: 16197,
  });

  gossipServer.on('portConfirmed', async (port) => {
    if (port && port !== apiPort) {
      log.info(`Gossip server got new apiPort: ${port}, updating`);
      // would be great if bench exposed an api for the apiport, this is brutal
      // or just tried all 8 ports on localhost, until it found one.
      const { benchmarkConfigFilePath } = userconfig.computed;
      const priorFile = await readFile(benchmarkConfigFilePath, { flag: 'a+' });
      if (priorFile !== `fluxport=${port}`) {
        await writeFile(benchmarkConfigFilePath, `fluxport=${port}`);
        await executeBenchmarkCall('restartnodebenchmarks');
      }
      apiPort = port;
    }
  });

  gossipServer.on('routerIpConfirmed', async (ip) => {
    if (ip && ip !== routerIp) {
      log.info(`Gossip server got new routerIp: ${ip}, updating`);
      await upnpService.ufwRemoveAllowSsdpforInit();
      // This is just good hygiene
      await upnpService.cleanOldMappings(ip);
      routerIp = ip;
    }
  });

  gossipServer.on('startError', () => {
    log.error('Upnp error starting gossipserver, starting again in 2 minutes...');
    setTimeout(() => gossipServer.start(), 2 * 60 * 1000);
  });

  gossipServer.start();
  return gossipServer;
}

function getGossipServer() {
  return gossipServer;
}

module.exports = {
  getApiPort,
  getRouterIp,
  startGossipServer,
  stopGossipServer,
  getGossipServer,
};
