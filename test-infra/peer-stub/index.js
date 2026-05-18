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
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const PUBLIC_KEY = process.env.PUBLIC_KEY;
const NODE_IP = process.env.NODE_IP;

if (!PRIVATE_KEY || !PUBLIC_KEY) {
  console.error('PRIVATE_KEY and PUBLIC_KEY env vars are required');
  process.exit(1);
}

const messages = new Map();

let connectionsReceived = 0;
let requestsReceived = 0;
let messagesServed = 0;
const requestLog = [];

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
      hashes = data.hashes;
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
  ws.on('message', (data) => handleMessage(ws, data));
  ws.on('error', () => {});
});

const wsServer = http.createServer((req, res) => {
  if (req.url === '/flux/version') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', data: '8.0.0' }));
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
      }));
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
