const http = require('http');
const { WebSocketServer } = require('ws');
const { signAsync } = require('@noble/secp256k1');
const { sha256 } = require('@noble/hashes/sha2');

if (process.env.FLUX_TEST_HARNESS !== 'true') {
  console.error('FLUX_TEST_HARNESS=true is required. This stub must only run inside the test harness.');
  process.exit(1);
}

const WS_PORT = Number(process.env.WS_PORT) || 16127;
const CONTROL_PORT = Number(process.env.CONTROL_PORT) || 16128;
const { PRIVATE_KEY, PUBLIC_KEY, NODE_IP } = process.env;

if (!PRIVATE_KEY || !PUBLIC_KEY) {
  console.error('PRIVATE_KEY and PUBLIC_KEY env vars are required');
  process.exit(1);
}

const messages = new Map();

let connectionsReceived = 0;
let requestsReceived = 0;
let messagesServed = 0;
const requestLog = [];

// What this peer answers when a node asks what it is holding, and when it was
// asked. The arrival times are the point: a node decides promotion for every
// folder in one monitor pass, so two arrivals milliseconds apart mean it asked
// once per folder rather than once for the pass.
let promotedFolders = { ready: true, folders: [] };
const promotedFolderRequests = [];

// The status this peer answers that question with. 200 is a peer that can answer
// it; anything else is a peer that cannot, and the one that matters is 404 -
// /apps/promotedfolders is new, so every node in the fleet answers 404 until it
// is upgraded. The fleet runs one image and can never be version-mixed, so
// without this a rollout is unreachable here and the asking node's handling of
// it can only ever be guessed at.
let promotedFoldersStatus = 200;

// The nodes currently connected to this peer. Held so the stub can SAY things
// rather than only answer them: a suite that needs a rival claim, a stale
// broadcast or a message a real node would never send gets a real peer sending
// it, signed and over the wire, instead of a row written behind the node's back.
const connectedNodes = new Set();
let broadcastsSent = 0;

function hash256(data) {
  return sha256(sha256(data));
}

function encodeVarint(n) {
  if (n < 253) return Buffer.from([n]);
  const buf = Buffer.alloc(3);
  buf[0] = 0xfd;
  buf.writeUInt16LE(n, 1);
  return buf;
}

function btcMagicHash(message) {
  const prefix = Buffer.from('\x18Bitcoin Signed Message:\n', 'utf8');
  const messageBuffer = Buffer.from(message, 'utf8');
  const varint = encodeVarint(messageBuffer.length);
  return hash256(Buffer.concat([prefix, varint, messageBuffer]));
}

async function signBtcMessage(message, privkeyHex) {
  const hashBytes = btcMagicHash(message);
  const sig = await signAsync(hashBytes, privkeyHex, { lowS: true });
  const flag = 27 + sig.recovery + 4;
  const out = Buffer.alloc(65);
  out[0] = flag;
  Buffer.from(sig.toCompactRawBytes()).copy(out, 1);
  return out.toString('base64');
}

async function serialiseAndSignBroadcast(data) {
  const version = 1;
  const timestamp = Date.now();
  const message = JSON.stringify(data);
  const messageToSign = `${version}${message}${timestamp}`;
  const signature = await signBtcMessage(messageToSign, PRIVATE_KEY);
  return JSON.stringify({ version, timestamp, pubKey: PUBLIC_KEY, signature, data });
}

async function handleMessage(ws, rawData) {
  try {
    const msg = JSON.parse(rawData);
    const { data } = msg;

    if (!data || data.type !== 'fluxapprequest') return;

    requestsReceived++;

    let hashes = [];
    if (data.version === 2 && Array.isArray(data.hashes)) {
      ({ hashes } = data);
    } else if (data.version === 1 && typeof data.hash === 'string') {
      hashes = [data.hash];
    }

    let served = 0;
    for (const hash of hashes) {
      const stored = messages.get(hash);
      if (stored) {
        const response = await serialiseAndSignBroadcast(stored);
        ws.send(response);
        messagesServed++;
        served++;
      }
    }

    requestLog.push({ timestamp: Date.now(), hashes, served });
  } catch (e) {
    console.error('Error handling message:', e.message);
  }
}

const wss = new WebSocketServer({ noServer: true });

wss.on('headers', (headers) => {
  headers.push('X-Flux-Capabilities: peerExchange,appStateSync');
  headers.push('X-Flux-Version: 8.0.0');
  headers.push('X-Flux-Uptime: 1000');
});

wss.on('connection', (ws) => {
  connectionsReceived++;
  connectedNodes.add(ws);
  ws.on('close', () => connectedNodes.delete(ws));
  ws.on('message', (data) => handleMessage(ws, data));
  ws.on('error', () => {});
});

const wsServer = http.createServer((req, res) => {
  if (req.url === '/flux/version') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', data: '8.0.0' }));
    return;
  }
  if (req.url === '/apps/promotedfolders') {
    // Recorded before the status is applied: a peer that answers 404 was still
    // asked, and a suite proving the asker kept asking needs to see that.
    promotedFolderRequests.push(Date.now());
    if (promotedFoldersStatus !== 200) {
      res.writeHead(promotedFoldersStatus);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', data: promotedFolders }));
    return;
  }
  res.writeHead(404);
  res.end();
});

wsServer.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws/flux/')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wsServer.listen(WS_PORT, () => {
  console.log(`Peer stub ${NODE_IP} WS server listening on port ${WS_PORT}`);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const controlServer = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ip: NODE_IP }));
      return;
    }

    if (req.method === 'GET' && req.url === '/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        connectionsReceived,
        requestsReceived,
        messagesServed,
        messagesLoaded: messages.size,
        requestLog,
        promotedFolderRequests,
        broadcastsSent,
        connectedNodes: connectedNodes.size,
      }));
      return;
    }

    // Say something to every node connected right now, signed with this peer's
    // own key and framed exactly as a real broadcast - so the receiving node
    // validates it, stores it and acts on it through the path it uses for any
    // other peer. The caller supplies the whole message, because what makes a
    // message interesting to a suite is usually the field a real peer would
    // never get wrong.
    if (req.method === 'POST' && req.url === '/broadcast') {
      const body = await readBody(req);
      const data = JSON.parse(body);
      const wire = await serialiseAndSignBroadcast(data);
      let sent = 0;
      for (const ws of connectedNodes) {
        if (ws.readyState === 1) { ws.send(wire); sent++; }
      }
      broadcastsSent += sent;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sent, connected: connectedNodes.size }));
      return;
    }

    if (req.method === 'POST' && req.url === '/promoted-folders') {
      const body = await readBody(req);
      const wanted = JSON.parse(body);
      promotedFolders = {
        ready: wanted.ready !== false,
        folders: Array.isArray(wanted.folders) ? wanted.folders : [],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', promotedFolders }));
      return;
    }

    if (req.method === 'POST' && req.url === '/promoted-folders-status') {
      const body = await readBody(req);
      const wanted = JSON.parse(body);
      promotedFoldersStatus = Number(wanted.status) || 200;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', promotedFoldersStatus }));
      return;
    }

    if (req.method === 'POST' && req.url === '/load-message') {
      const body = await readBody(req);
      const msg = JSON.parse(body);
      messages.set(msg.hash, {
        type: msg.type,
        version: msg.version,
        appSpecifications: msg.appSpecifications,
        hash: msg.hash,
        timestamp: msg.timestamp,
        signature: msg.signature,
        arcaneSender: msg.arcaneSender ?? true,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', hash: msg.hash }));
      return;
    }

    if (req.method === 'POST' && req.url === '/clear') {
      messages.clear();
      requestLog.length = 0;
      connectionsReceived = 0;
      requestsReceived = 0;
      messagesServed = 0;
      promotedFolderRequests.length = 0;
      promotedFolders = { ready: true, folders: [] };
      promotedFoldersStatus = 200;
      broadcastsSent = 0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    res.writeHead(404);
    res.end();
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: e.message }));
  }
});

controlServer.listen(CONTROL_PORT, () => {
  console.log(`Peer stub ${NODE_IP} control API listening on port ${CONTROL_PORT}`);
});
