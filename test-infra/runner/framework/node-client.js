import { EventEmitter } from 'node:events';
import { EventSource } from 'eventsource';
import { getSubnetConfig } from './subnet-config.js';
import { infraDeathError, offInfraDeath, onInfraDeath } from './infra-death.js';

export function nodeClient(nodeNum) {
  const ip = getSubnetConfig().nodeIp(nodeNum);
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

  // The whole response, for endpoints whose answer is not only its body.
  //
  // get/getAuthed/post return parsed JSON because that is what almost every
  // suite wants, but a 202 puts its answer in Location/Operation-Id/Retry-After
  // and a refusal puts its answer in the status code - both invisible through
  // those. The body is parsed when it is JSON and handed back as text when it
  // is not, so a suite asserting on a failure sees what actually came back
  // rather than a parse error standing in for it.
  async function request(method, path, { body = null, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };
    if (body !== null) {
      init.headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${url}${path}`, init);
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON - keep the text
    }
    return { status: res.status, headers: Object.fromEntries(res.headers), data };
  }

  async function del(path, zelidauth) {
    const res = await fetch(`${url}${path}`, {
      method: 'DELETE',
      headers: zelidauth ? { zelidauth } : {},
    });
    return res.json();
  }

  /**
   * Upload files the way a browser does: ONE multipart request carrying all of
   * them, each under its own name.
   *
   * The endpoint takes each file's destination name from its form field name,
   * which is what a browser sends when it appends a File under its own name.
   *
   * The response is not JSON. It is a stream of progress figures with each
   * file's name written into it as that file lands, and a failure envelope
   * written into the same stream - the status line has long gone by the time
   * anything can go wrong. So the body comes back as text and a suite reads
   * what it needs out of it.
   *
   * @param {string} path
   * @param {Record<string, string|Uint8Array>} files - name to contents
   * @param {object} [headers]
   * @returns {Promise<{status: number, body: string}>}
   */
  async function upload(path, files, headers = {}) {
    const form = new FormData();
    for (const [name, contents] of Object.entries(files)) {
      // The third argument is the filename; the first is the field name. The
      // endpoint reads the field name, and a browser makes them the same.
      form.append(name, new Blob([contents]), name);
    }
    // Content-Type is deliberately not set: fetch fills it in with the
    // multipart boundary it generated, and overriding it produces a body no
    // parser can read.
    const res = await fetch(`${url}${path}`, { method: 'POST', headers, body: form });
    return { status: res.status, body: await res.text() };
  }

  /**
   * Upload one file with the body arriving in pieces, slowly.
   *
   * The stall check stops an operation that has got nowhere, and it reads how
   * much the volume has consumed - which for an upload only moves once enough
   * bytes have arrived to fill a filesystem block. A client on a slow link
   * sending a small file moves nothing measurable for the whole window, so this
   * is what tells a trickle apart from a wedged container.
   *
   * The body is built by hand rather than by FormData: what is under test is
   * bytes arriving over time, and FormData hands over a body that is already
   * complete.
   *
   * @param {string} path
   * @param {{name: string, contents: string}} file
   * @param {object} headers
   * @param {{pieces?: number, everyMs?: number}} pace
   * @returns {Promise<{status: number, body: string}>}
   */
  async function uploadSlowly(path, file, headers = {}, pace = {}) {
    const { pieces = 10, everyMs = 500 } = pace;
    const boundary = `----fluxharness${Date.now()}`;
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.name}"\r\n`
      + 'Content-Type: application/octet-stream\r\n\r\n';
    const tail = `\r\n--${boundary}--\r\n`;
    const size = Math.max(1, Math.ceil(file.contents.length / pieces));

    const body = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(head));
        for (let at = 0; at < file.contents.length; at += size) {
          // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
          await new Promise((resolve) => { setTimeout(resolve, everyMs); });
          controller.enqueue(encoder.encode(file.contents.slice(at, at + size)));
        }
        controller.enqueue(encoder.encode(tail));
        controller.close();
      },
    });

    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
      duplex: 'half',
    });
    return { status: res.status, body: await res.text() };
  }

  let eventSource = null;
  let streamGapError = null;
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

      // The node fell behind its ring while this client was disconnected, so
      // some events are gone for good. Every parked wait fails here, naming the
      // cause - otherwise each one runs out its own budget waiting for an event
      // that already came and went, and reports as a product bug.
      eventSource.addEventListener('stream:gap', (e) => {
        let dropped = 'an unknown number of';
        try { ({ dropped } = JSON.parse(e.data)); } catch { /* keep the default */ }
        streamGapError = new Error(
          `node ${ip} dropped ${dropped} events while this client was disconnected - `
          + 'any wait for one of them can never be satisfied',
        );
        emitter.emit('streamGap', streamGapError);
      });

      for (const name of [
        'block:processed',
        'masterSlave:started',
        'stream:gap',
        'boot:settled',
        'confirmation:changed',
        'daemon:polled',
        'daemon:recovered',
        'daemon:unreachable',
        'dos:changed',
        'explorer:ready',
        'messageCapability:changed',
        'networkstate:updated',
        'orchestrator:started',
        'orchestrator:stateChanged',
        'app:installed',
        'app:removed',
        'app:specStored',
        'app:running',
        'fileoperation:imageAcquired',
        'fileoperation:imageDiscarded',
        'imageUpdate:checked',
        'imageUpdate:redeployTriggered',
        'imageUpdate:redeployComplete',
        'peers:added',
        'peers:belowThreshold',
        'peers:removed',
        'peers:thresholdReached',
        'syncthing:folderErrors',
        'syncthing:eventsResync',
        'syncthing:holderRetained',
        'syncthing:holderExcluded',
        'spawner:blocked',
        'spawner:deferred',
        'spawner:installFailed',
        'spawner:networkErrorSkip',
        'spawner:paused',
        'spawner:resumed',
        'network:apprunning',
        'network:appinstalling',
        'network:appinstallingerror',
        'network:appremoved',
        'network:appmessage',
        'network:ipchanged',
        'network:sigterm',
        'ephemeralSync:requested',
        'ephemeralSync:peerComplete',
        'ephemeralSync:allComplete',
        'sync:chunkVerified',
        'hashSync:complete',
        'hashSync:failed',
        'hashRequest:received',
        'hashRequest:responded',
        'message:dispatched',
        'reconciler:actuated',
        'reconciler:desiredChanged',
        'reconciler:swept',
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
    streamGapError = null;
    const names = emitter.eventNames().filter((n) => n !== 'error');
    for (const name of names) emitter.removeAllListeners(name);
  }

  function waitForEvent(name, predicate = () => true, timeout = 30000, { afterId = 0 } = {}) {
    // An infra container the node depends on is already gone: the event can never
    // arrive, so fail now instead of spending this wait's whole budget proving it.
    const dead = infraDeathError();
    if (dead) return Promise.reject(dead);
    // Same reasoning: the event may already have been dropped, so waiting for it
    // proves nothing.
    if (streamGapError) return Promise.reject(streamGapError);

    const found = eventBuffer.find((e) => e.event === name && e.id > afterId && predicate(e.data));
    if (found) return Promise.resolve(found);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout after ${timeout}ms waiting for event: ${name}`));
      }, timeout);

      function handler(entry) {
        if (entry.id > afterId && predicate(entry.data)) {
          cleanup();
          resolve(entry);
        }
      }

      // Infra died while this wait was parked - fail AT the death, naming it,
      // rather than at the deadline with a timeout that reads like a product bug.
      function onDeath(err) {
        cleanup();
        reject(err);
      }

      function cleanup() {
        clearTimeout(timer);
        emitter.removeListener(name, handler);
        emitter.removeListener('streamGap', onDeath);
        offInfraDeath(onDeath);
      }

      emitter.on(name, handler);
      emitter.on('streamGap', onDeath);
      onInfraDeath(onDeath);
    });
  }

  // Cadence, read on demand rather than streamed - see the rule at the top of
  // ZelBack/src/services/utils/fluxEventBus.js.
  async function getTestCounters() {
    const res = await get('/flux/testcounters');
    return res.status === 'success' ? res.data : {};
  }

  // Times a loop has been observed taking a given decision about a component.
  // Absent counters read as 0, so a caller can difference two reads without
  // caring whether the loop has run yet.
  async function getDecisionCount(counterName, identifier, decision) {
    const counters = await getTestCounters();
    return counters?.[counterName]?.[identifier]?.[decision] || 0;
  }

  function getLastEventId() {
    if (eventBuffer.length === 0) return 0;
    return eventBuffer[eventBuffer.length - 1].id;
  }

  return {
    ip,
    url,
    num: nodeNum,
    get,
    getAuthed,
    post,
    del,
    upload,
    uploadSlowly,
    request,
    connectEventStream,
    disconnectEventStream,
    waitForEvent,
    getTestCounters,
    getDecisionCount,
    getLastEventId,
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
    // Trigger a real local install on THIS node. The endpoint streams install
    // progress as concatenated JSON chunks (not a single JSON doc), so drain the
    // body as text; resolves when the install stream ends. Confirm completion via
    // the app:installed event (waitForAppInstalled).
    installAppLocally: async (appname, zelidauth) => {
      const res = await fetch(`${url}/apps/installapplocally/${appname}`, { headers: { zelidauth } });
      return res.text();
    },
    // Backup/restore drive the whole-app lease (B1). The endpoints stream chunked
    // progress and the returned promise resolves when the task FINISHES - so a
    // suite holds the lease window by simply not awaiting yet.
    appendBackupTask: async (appname, components, zelidauth) => {
      const res = await fetch(`${url}/apps/appendbackuptask`, {
        method: 'POST',
        headers: { zelidauth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appname, backup: components.map((component) => ({ component, backup: true })) }),
      });
      return res.text();
    },
    appendRestoreTask: async (appname, restore, type, zelidauth) => {
      const res = await fetch(`${url}/apps/appendrestoretask`, {
        method: 'POST',
        headers: { zelidauth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appname, restore, type }),
      });
      return res.text();
    },
  };
}

export function allNodes(count = 16) {
  return Array.from({ length: count }, (_, i) => nodeClient(i + 1));
}
