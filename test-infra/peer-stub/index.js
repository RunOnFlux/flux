const http = require('http');
const net = require('net');
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

// Whether this peer answers that question AT ALL. A status - even 404 - is an
// answer, and the asking node reads any answer as proof the peer is alive. A
// peer whose FluxOS is down does not answer: the connection is refused. That is
// a different fact and the node treats it differently, so a suite that needs a
// holder which is alive but unanswerable has to be able to produce it.
let promotedFoldersRefuse = false;

// Whether this peer passes a port test WITHOUT connecting to the asker.
//
// This is what a shared public address looks like from the asker's side. Several
// Flux nodes commonly sit behind one router, which forwards each port to exactly
// one of them, so a peer probing the shared address can reach a sibling node's
// application while the asker's own test server sits unreached behind the same
// NAT. The peer is not lying and cannot tell: something genuinely answered.
//
// The stub cannot reproduce the NAT, but it can reproduce what the asker
// receives - a pass for a port the asker was never reached on - which is the
// only part of it the asker can act on.
let portProbeAnswersBlind = false;

// Answers the port test with a reading that is NOT the asker's - what the asker
// receives when the router forwarded that port to a neighbour and a different
// application replied. The stub cannot reproduce the NAT; it reproduces what
// comes back through it, which is the only part the asker can act on.
let portProbeAnswersForeign = false;

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
  // peerExchange only. This stub does NOT implement the app-state sync
  // endpoints - apprunning, appinstalling and apperrors are all absent - and a
  // real node picks its sync peers by exactly this capability
  // (FluxPeerManager.getEligibleSyncPeers). Claiming it made stubs eligible,
  // so a node would ask one, get nothing, time out, and never publish
  // SPAWNER_READY - which never starts the spawn loop. A fleet with several
  // stubs then had a real chance of drawing only stubs, and every test needing
  // an app to be spawned waited out its whole budget for a spawner that was
  // never running. Suite 98 lost a gate to it.
  headers.push('X-Flux-Capabilities: peerExchange');
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

// Whether a TCP connection to the asker's port completes. A timeout answers for
// a port that is filtered rather than refused - to the node asking, both mean
// the same thing.
// Reads what a port replies, capped, the way a node on current code does.
function portRead(ip, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port });
    let received = '';
    let settled = false;
    const done = (answer) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.write(`GET / HTTP/1.1\r\nHost: ${ip}:${port}\r\nConnection: close\r\n\r\n`);
    });
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8');
      if (received.length >= 256) done(received.slice(0, 256));
    });
    socket.once('end', () => done(received || null));
    socket.once('timeout', () => done(received || null));
    socket.once('error', () => done(null));
  });
}

function portAnswers(ip, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port });
    const done = (reachable) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

const wsServer = http.createServer(async (req, res) => {
  // The handler awaits, so a request that fails while being read rejects rather
  // than throwing, and an unhandled rejection takes the process with it. Every
  // path answers.
  try {
    if (req.method === 'POST' && req.url === '/flux/checkappavailability') {
      // Before installing, a node opens its ports and asks a RANDOM peer to
      // confirm they answer from outside; it aborts the install if no peer
      // confirms within its attempts. A stub that 404s here is a peer that can
      // never confirm, so every node that draws one burns an attempt, and a fleet
      // carrying several of them fails installs with nothing wrong.
      //
      // Really connected rather than answered blind: the asker opens those ports
      // for this check alone, and a stub that always said yes would mask the exact
      // failure the check exists to find.
      const body = await readBody(req);
      let asked;
      try {
        asked = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', data: { message: 'Unparseable request' } }));
        return;
      }
      // Probed together rather than in turn: the asker gives this whole exchange
      // one timeout, and a serial walk of several ports spends that budget before
      // it can answer.
      const ports = Array.isArray(asked.ports) ? asked.ports : [];
      if (portProbeAnswersBlind) {
        // Passed without connecting: see portProbeAnswersBlind.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', data: { message: 'Ports are available' } }));
        return;
      }
      // A requester asking for proof gets what each port actually said. One that
      // is not - an older node - gets the reachability answer it always got, and
      // no `answered` field, which is how the asker knows this peer cannot prove
      // anything either way.
      if (asked.echo && !portProbeAnswersBlind) {
        const answered = {};
        for (const port of ports) {
          // eslint-disable-next-line no-await-in-loop
          const reply = portProbeAnswersForeign
            ? 'HTTP/1.1 200 OK\r\n\r\n{"status":"success","data":{"token":"a-neighbours-application"}}'
            : await portRead(asked.ip, port);
          if (reply === null) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', data: { message: `Failed port: ${port}` } }));
            return;
          }
          answered[port] = reply;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          data: { message: 'Ports are available', answered },
        }));
        return;
      }
      const reachable = await Promise.all(ports.map((port) => portAnswers(asked.ip, port)));
      const failedAt = reachable.indexOf(false);
      if (failedAt !== -1) {
        // Named, because the asker reads the number back out of this message to
        // decide which port to retest.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', data: { message: `Failed port: ${ports[failedAt]}` } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', data: { message: 'Ports are available' } }));
      return;
    }
    if (req.url === '/flux/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', data: '8.0.0' }));
      return;
    }
    if (req.url === '/syncthing/deviceid') {
      // Every real node answers this, however old - the endpoint long predates
      // /apps/promotedfolders, which is the only version distinction this stub
      // models. Nodes cache the answer to name this peer in queries against
      // their own syncthing, so a stub that 404s here starves that cache and
      // silently disables every check built on it.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', data: 'PEERSTUB-DEVICE-0000001' }));
      return;
    }
    if (req.url === '/apps/promotedfolders') {
      // Recorded before the status is applied: a peer that answers 404 was still
      // asked, and a suite proving the asker kept asking needs to see that.
      promotedFolderRequests.push(Date.now());
      if (promotedFoldersRefuse) {
        // Destroyed rather than answered, so the asker sees the transport fail
        // exactly as it does against a node whose FluxOS is not listening.
        req.socket.destroy();
        return;
      }
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
  } catch (e) {
    console.error(`peer stub: ${req.method} ${req.url} failed: ${e.message}`);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    if (!res.writableEnded) res.end(JSON.stringify({ status: 'error', data: { message: e.message } }));
  }
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
      promotedFoldersRefuse = false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', promotedFoldersStatus }));
      return;
    }

    if (req.method === 'POST' && req.url === '/promoted-folders-refuse') {
      const body = await readBody(req);
      promotedFoldersRefuse = JSON.parse(body).refuse !== false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', promotedFoldersRefuse }));
      return;
    }

    if (req.method === 'POST' && req.url === '/port-probe-foreign') {
      const body = await readBody(req);
      portProbeAnswersForeign = JSON.parse(body).foreign !== false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', portProbeAnswersForeign }));
      return;
    }

    if (req.method === 'POST' && req.url === '/port-probe-blind') {
      const body = await readBody(req);
      portProbeAnswersBlind = JSON.parse(body).blind !== false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', portProbeAnswersBlind }));
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
      promotedFoldersRefuse = false;
      portProbeAnswersBlind = false;
      portProbeAnswersForeign = false;
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
