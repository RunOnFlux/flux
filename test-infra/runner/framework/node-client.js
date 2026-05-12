export function nodeClient(nodeNum) {
  const ip = `198.18.${nodeNum}.0`;
  const url = `http://${ip}:16127`;

  async function get(path) {
    const res = await fetch(`${url}${path}`);
    return res.json();
  }

  async function post(path, body, headers = {}) {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  return {
    ip,
    url,
    num: nodeNum,
    get,
    post,
    getVersion: () => get('/flux/version'),
    getPeers: () => get('/flux/connectedpeers'),
    getNodeStatus: () => get('/daemon/getzelnodestatus'),
    getBlockchainInfo: () => get('/daemon/getblockchaininfo'),
    getExplorerHeight: () => get('/explorer/scannedheight'),
    isExplorerSynced: () => get('/explorer/issynced'),
    getFluxInfo: () => get('/flux/info'),
    getDOSState: () => get(`/flux/dosstate?_=${Date.now()}`),
    setDOSState: (dosState, dosMessage, zelidauth) =>
      post('/flux/dosstate', { dosState, dosMessage }, { zelidauth }),
    getAppLocations: (name) => get(`/apps/location/${name}`),
    getPermanentMessages: () => get('/apps/permanentmessages'),
    getTempMessages: (hash) => get(`/apps/temporarymessages/${hash}`),
    getAppSpecs: (name) => get(`/apps/appspecifications/${name}`),
    getInstalledApps: () => get('/apps/installedapps'),
    getRunningApps: () => get('/apps/runningapps'),
    getLoginPhrase: () => get('/id/loginphrase'),
    verifyLogin: (body) => post('/id/verifylogin', body),
  };
}

export function allNodes(count = 16) {
  return Array.from({ length: count }, (_, i) => nodeClient(i + 1));
}
