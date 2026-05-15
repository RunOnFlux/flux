import { EventEmitter } from 'node:events';
import { EventSource } from 'eventsource';

export function nodeClient(nodeNum) {
  const ip = `198.18.${nodeNum}.0`;
  const url = `http://${ip}:16127`;

  async function get(path) {
    const res = await fetch(`${url}${path}`);
    return res.json();
  }

  async function getAuthed(path, zelidauth) {
    const res = await fetch(`${url}${path}`, { headers: { zelidauth } });
    return res.json();
  }

  async function post(path, body, headers = {}) {
    const contentType = headers['Content-Type'] ?? 'application/json';
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, ...headers },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  let eventSource = null;
  const eventBuffer = [];
  const emitter = new EventEmitter();
  emitter.on('error', () => {});

  function connectEventStream(timeout = 60000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SSE connect timeout after ${timeout}ms for ${ip}`));
      }, timeout);

      eventSource = new EventSource(`${url}/flux/eventstream`);

      eventSource.onopen = () => {
        clearTimeout(timer);
        resolve();
      };

      eventSource.onerror = (err) => {
        emitter.emit('error', err);
      };

      for (const name of [
        'block:processed',
        'boot:settled',
        'confirmation:changed',
        'daemon:polled',
        'daemon:recovered',
        'daemon:unreachable',
        'dos:changed',
        'explorer:ready',
        'messageCapability:changed',
        'orchestrator:started',
        'orchestrator:stateChanged',
        'app:installed',
        'app:removed',
        'app:specStored',
        'peers:added',
        'peers:belowThreshold',
        'peers:removed',
        'peers:thresholdReached',
        'spawner:blocked',
        'spawner:paused',
        'spawner:resumed',
      ]) {
        eventSource.addEventListener(name, (e) => {
          const entry = {
            event: e.type,
            data: JSON.parse(e.data),
            id: parseInt(e.lastEventId, 10) || 0,
          };
          eventBuffer.push(entry);
          emitter.emit(e.type, entry);
        });
      }
    });
  }

  function disconnectEventStream() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    eventBuffer.length = 0;
    emitter.removeAllListeners();
  }

  function waitForEvent(name, predicate = () => true, timeout = 30000) {
    const found = eventBuffer.find((e) => e.event === name && predicate(e.data));
    if (found) return Promise.resolve(found);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout after ${timeout}ms waiting for event: ${name}`));
      }, timeout);

      function handler(entry) {
        if (predicate(entry.data)) {
          cleanup();
          resolve(entry);
        }
      }

      function cleanup() {
        clearTimeout(timer);
        emitter.removeListener(name, handler);
      }

      emitter.on(name, handler);
    });
  }

  return {
    ip,
    url,
    num: nodeNum,
    get,
    getAuthed,
    post,
    connectEventStream,
    disconnectEventStream,
    waitForEvent,
    getEventBuffer: () => [...eventBuffer],
    getVersion: () => get('/flux/version'),
    getPeers: () => get('/flux/connectedpeers'),
    getIncomingPeers: () => get('/flux/incomingconnections'),
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
    verifyLogin: (body) => post('/id/verifylogin', body, { 'Content-Type': 'text/plain' }),
  };
}

export function allNodes(count = 16) {
  return Array.from({ length: count }, (_, i) => nodeClient(i + 1));
}
