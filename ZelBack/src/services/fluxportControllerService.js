const path = require('node:path');
const { existsSync } = require("node:fs")
const { writeFile, readFile } = require("node:fs/promises");

const log = require('../lib/log');
const { obtainNodeCollateralInformation } = require("./generalService");
const { ufwAllowSsdpforInit, ufwRemoveAllowSsdpforInit, cleanOldMappings } = require("./upnpService");
const { FluxGossipServer } = require("@megachips/fluxport-controller");
const { executeCall: executeBenchmarkCall } = require("./benchmarkService");

const homeDirPath = path.join(__dirname, '../../../../');
const newBenchmarkPath = path.join(homeDirPath, '.fluxbenchmark');
const oldBenchmarkPath = path.join(homeDirPath, '.zelbenchmark');
const isNewBenchPath = existsSync(newBenchmarkPath)

const benchmarkPath = isNewBenchPath ? newBenchmarkPath : oldBenchmarkPath
const benchmarkFile = isNewBenchPath ? "fluxbench.conf" : "zelbench.conf"
const benchmarkConfig = path.join(benchmarkPath, benchmarkFile);

let apiPort = null;
let routerIp = null;
let outPoint = null;
let gossipServer = null;

async function getApiPort() {
  return new Promise(async (resolve, reject) => {
    if (apiPort) resolve(apiPort);

    if (!(gossipServer)) reject("gossipServer not ready");

    gossipServer.once("portConfirmed", (apiPort) => resolve(apiPort));
  });
}

function getRouterIp() {
  return new Promise(async (resolve, reject) => {
    if (routerIp) resolve(routerIp);

    if (!(gossipServer)) reject("gossipServer not ready");

    gossipServer.once("portConfirmed", (routerIp) => resolve(routerIp));
  });
}

async function startGossipServer() {
  if (gossipServer) return true;

  try {
    // this is reliant on fluxd running
    const res = await obtainNodeCollateralInformation();
    outPoint = { txhash: res.txhash, outidx: res.txindex }
  } catch {
    log.error("Error getting collateral info from daemon.");
    return false;
  }

  if (!(await ufwAllowSsdpforInit())) {
    log.error("Error adjusting firewallfor SSDP.")
    return false;
  }

  // Using the port 16197 is fine here, even if in use. Flux uses tcp
  // whereas this uses UDP. Also, the gossipServer doesn't bind to the interface
  // address, only the multicast address so you won't get EADDRINUSE. Its good as
  // Flux already opens this port.
  gossipServer = new FluxGossipServer(outPoint, {
    // seems as good as any multicast address
    multicastGroup: "239.19.38.57",
    port: 16197,
  });

  gossipServer.on("portConfirmed", async (port) => {
    if (port && port !== apiPort) {
      log.info(`Gossip server got new apiPort: ${port}, updating`);
      // would be great if bench exposed an api for the apiport, this is brutal
      // or just tried all 8 ports on localhost, until it found one.
      const priorFile = await readFile(benchmarkConfig, { flag: "a+" });
      if (priorFile !== `fluxport=${port}`) {
        await writeFile(benchmarkConfig, `fluxport=${port}`);
        await executeBenchmarkCall("restartnodebenchmarks");
      }
      apiPort = port;
    }
  });

  gossipServer.on("routerIpConfirmed", async (ip) => {
    if (ip && ip !== routerIp) {
      log.info(`Gossip server got new routerIp: ${ip}, updating`);
      await ufwRemoveAllowSsdpforInit();
      // This is just good hygiene
      await cleanOldMappings(ip);
      routerIp = ip;
    }
  })

  gossipServer.on("startError", () => {
    log.error("Upnp error starting gossipserver, starting again in 2 minutes...");
    setTimeout(() => gossipServer.start(), 2 * 60 * 1000);
  });

  gossipServer.start();
  return true;
}

module.exports = {
  getApiPort,
  startGossipServer,
  getRouterIp
}
