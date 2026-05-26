const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

if (process.env.FLUX_TEST_HARNESS !== 'true') {
  console.error('FLUX_TEST_HARNESS=true is required. This stub must only run inside the test harness.');
  process.exit(1);
}

const FLUXD_PORT = Number(process.env.FLUXD_PORT) || 16124;
const BENCHD_PORT = Number(process.env.BENCHD_PORT) || 16224;
const CONTROL_PORT = Number(process.env.CONTROL_PORT) || 18232;

let currentHeight = Number(process.env.INITIAL_HEIGHT) || 2100000;
let deterministicNodeList = [];
let originalNodeList = [];
let pendingBlocks = [];

const nodeStatusOverrides = new Map();
const rpcFailures = new Map();
const requestJournal = [];
const MAX_JOURNAL_SIZE = 10000;

const seededAddressDeltas = [];
const seededAddressTxids = [];
const seededTransactions = new Map();

const fixturesDir = process.env.FIXTURES_DIR || path.join(__dirname, '..', 'fixtures');

const NODE_COUNT = Number(process.env.NODE_COUNT) || 16;

try {
  const listPath = path.join(fixturesDir, 'deterministic-list.json');
  if (fs.existsSync(listPath)) {
    const fullList = JSON.parse(fs.readFileSync(listPath, 'utf-8'));
    originalNodeList = fullList.slice(0, NODE_COUNT);
    deterministicNodeList = [...originalNodeList];
  }
} catch (e) {
  console.error('Failed to load deterministic list:', e.message);
}

function nodeBySourceIp(sourceIp) {
  const clean = sourceIp.replace('::ffff:', '');
  return deterministicNodeList.find((n) => n.ip.split(':')[0] === clean) || null;
}

const rpcHandlers = {
  getblockchaininfo: () => ({
    chain: 'main',
    blocks: currentHeight,
    headers: currentHeight,
    bestblockhash: `000000000000stub${currentHeight}`,
    difficulty: 1000,
    verificationprogress: 1,
    chainwork: '0000000000000000000000000000000000000000000000000000000000000001',
  }),

  getblockcount: () => currentHeight,

  getinfo: () => ({
    version: 6010050,
    protocolversion: 170019,
    walletversion: 60000,
    balance: 0,
    blocks: currentHeight,
    timeoffset: 0,
    connections: deterministicNodeList.length,
    proxy: '',
    difficulty: 1000,
    testnet: false,
    errors: '',
  }),

  getnetworkinfo: () => ({
    version: 6010050,
    subversion: '/Flux:6.1.0/',
    protocolversion: 170019,
    localservices: '0000000000000005',
    timeoffset: 0,
    connections: deterministicNodeList.length,
    networks: [],
    relayfee: 0.000001,
    localaddresses: [],
  }),

  getpeerinfo: () => [],

  getchaintips: () => [
    { height: currentHeight, hash: `000000000000stub${currentHeight}`, branchlen: 0, status: 'active' },
  ],

  getbestblockhash: () => `000000000000stub${currentHeight}`,

  getblockhash: (params) => {
    const height = params[0];
    return `000000000000stub${height}`;
  },

  getblock: (params) => {
    const hashOrHeight = params[0];
    const verbosity = params[1] || 1;
    const asNum = Number(hashOrHeight);

    const pending = pendingBlocks.find((b) => b.height === asNum || b.height === hashOrHeight || b.hash === hashOrHeight);
    if (pending) return pending;

    const height = !Number.isNaN(asNum) ? asNum : currentHeight;
    const block = {
      hash: `000000000000stub${height}`,
      confirmations: currentHeight - height + 1,
      size: 1000,
      height,
      version: 4,
      merkleroot: '0000000000000000000000000000000000000000000000000000000000000000',
      tx: [],
      time: Math.floor(Date.now() / 1000),
      nonce: 0,
      difficulty: 1000,
      previousblockhash: height > 0 ? `000000000000stub${height - 1}` : undefined,
      nextblockhash: height < currentHeight ? `000000000000stub${height + 1}` : undefined,
    };

    if (verbosity === 2) {
      block.tx = [];
    }

    return block;
  },

  getblockheader: (params) => {
    const hash = params[0];
    return {
      hash,
      confirmations: 1,
      height: currentHeight,
      version: 4,
      previousblockhash: `000000000000stub${currentHeight - 1}`,
      time: Math.floor(Date.now() / 1000),
    };
  },

  getmempoolinfo: () => ({ size: 0, bytes: 0, usage: 0 }),
  getrawmempool: () => [],

  viewdeterministiczelnodelist: () => deterministicNodeList,
  viewdeterministicfluxnodelist: () => deterministicNodeList,

  getzelnodestatus: (params, sourceIp) => {
    const node = nodeBySourceIp(sourceIp);
    const clean = sourceIp.replace('::ffff:', '');
    const override = nodeStatusOverrides.get(clean);
    return {
      status: override?.status ?? 'CONFIRMED',
      collateral: node ? node.collateral : 'COutPoint(0000000000000000000000000000000000000000000000000000000000000000, 0)',
      txhash: node ? node.txhash : '0000000000000000000000000000000000000000000000000000000000000000',
      outidx: node ? node.outidx : '0',
      ip: node ? node.ip : '127.0.0.1',
      network: '',
      added_height: node ? node.added_height : currentHeight - 1000,
      confirmed_height: node ? node.confirmed_height : currentHeight - 500,
      last_confirmed_height: node ? node.last_confirmed_height : currentHeight - 10,
      last_paid_height: node ? node.last_paid_height : currentHeight - 100,
      tier: node ? node.tier : 'CUMULUS',
      payment_address: node ? node.payment_address : 'stub-payment-address',
      pubkey: node ? node.pubkey : 'stub-pubkey',
      activesince: node ? String(node.activesince) : String(Math.floor(Date.now() / 1000) - 86400),
      lastpaid: node ? String(node.lastpaid) : String(Math.floor(Date.now() / 1000) - 3600),
      amount: '1000.00',
      rank: node ? node.rank : 1,
    };
  },

  getfluxnodestatus: function f(params, sourceIp) { return this.getzelnodestatus(params, sourceIp); },

  getzelnodecount: () => ({
    total: deterministicNodeList.length,
    stable: deterministicNodeList.length,
    enabled: deterministicNodeList.length,
    'inqueue-total': 0,
    'ipv4-total': deterministicNodeList.length,
    'ipv6-total': 0,
    'onion-total': 0,
  }),

  getfluxnodecount: function f(params) { return this.getzelnodecount(params); },

  getdoslist: () => [],
  getstartlist: () => [],

  listfluxnodes: () => deterministicNodeList,
  listzelnodes: () => deterministicNodeList,

  getrawtransaction: (params) => {
    const txid = params[0];
    const verbose = params[1] || 0;
    if (verbose && seededTransactions.has(txid)) {
      return seededTransactions.get(txid);
    }
    if (verbose) {
      const collateralAmounts = { CUMULUS: 1000, NIMBUS: 12500, STRATUS: 40000 };
      const node = deterministicNodeList.find((n) => n.txhash === txid);
      const outidx = node ? Number(node.outidx) : 0;
      const amount = node ? (collateralAmounts[node.tier] || 1000) : 0;
      const vout = [];
      for (let i = 0; i <= outidx; i++) {
        vout.push({
          value: i === outidx ? amount : 0,
          n: i,
          scriptPubKey: { addresses: [node ? node.payment_address : 'stub-address'] },
        });
      }
      return {
        txid,
        version: 1,
        locktime: 0,
        vin: [],
        vout,
        blockhash: `000000000000stub${currentHeight}`,
        confirmations: 1,
        time: Math.floor(Date.now() / 1000),
        blocktime: Math.floor(Date.now() / 1000),
      };
    }
    return '0100000000000000000000';
  },

  createconfirmationtransaction: () => ({ hex: 'stub-confirmation-tx-hex' }),

  getaddressbalance: () => ({ balance: 0, received: 0 }),
  getaddressutxos: () => [],
  getaddresstxids: () => (seededAddressTxids.length > 0 ? seededAddressTxids : []),
  getaddressdeltas: () => (seededAddressDeltas.length > 0 ? seededAddressDeltas : []),

  listunspent: () => [],
  validateaddress: (params) => ({
    isvalid: true,
    address: params[0],
    ismine: false,
    iswatchonly: false,
    isscript: false,
  }),

  signmessage: (params) => `stub-signature-for-${params[1]}`,

  getconnectioncount: () => deterministicNodeList.length,
  getdifficulty: () => 1000,
  getmininginfo: () => ({ blocks: currentHeight, difficulty: 1000, networkhashps: 0 }),
  getblocksubsidy: () => ({ miner: 37.5, founders: 0 }),

  getspentinfo: () => null,
  gettxout: () => null,

  help: () => 'Flux daemon stub - all methods stubbed for E2E testing',
  stop: () => 'Flux daemon stopping (stub)',
};

const benchHandlers = {
  getbenchmarks: (params, sourceIp) => {
    const node = nodeBySourceIp(sourceIp);
    const tier = node ? node.tier.toLowerCase() : 'cumulus';
    const specs = {
      cumulus: { cores: 4, ram: 7.5, ssd: 240, hdd: 0, ddwrite: 200, eps: 500, ping: 5, download_speed: 200, upload_speed: 100 },
      nimbus: { cores: 8, ram: 31, ssd: 480, hdd: 0, ddwrite: 300, eps: 1000, ping: 3, download_speed: 500, upload_speed: 250 },
      stratus: { cores: 16, ram: 62, ssd: 960, hdd: 0, ddwrite: 400, eps: 2000, ping: 2, download_speed: 1000, upload_speed: 500 },
    };
    const s = specs[tier] || specs.cumulus;
    return {
      ipaddress: node ? node.ip : '127.0.0.1',
      cores: s.cores,
      ram: s.ram,
      ssd: s.ssd,
      hdd: s.hdd,
      ddwrite: s.ddwrite,
      totalstorage: s.ssd + s.hdd,
      disksinfo: [],
      eps: s.eps,
      ping: s.ping,
      download_speed: s.download_speed,
      upload_speed: s.upload_speed,
      bench_version: '5.0.0',
      flux_version: '8.0.0',
      architecture: 'amd64',
      thunder: false,
      real_cores: s.cores,
      speed: 3000,
    };
  },

  getstatus: () => ({
    status: 'online',
    benchmarking: 'complete',
    flux: true,
  }),

  getpublicip: (params, sourceIp) => {
    const node = nodeBySourceIp(sourceIp);
    return node ? node.ip.split(':')[0] : '127.0.0.1';
  },

  getpublickey: (params, sourceIp) => {
    const node = nodeBySourceIp(sourceIp);
    return node ? node.pubkey : 'stub-pubkey';
  },

  getinfo: () => ({
    version: '5.0.0',
    rpcport: BENCHD_PORT,
  }),

  decryptrsamessage: () => JSON.stringify({
    status: 'ok',
    message: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  }),

  help: () => 'Flux benchmark stub',
  stop: () => 'Flux benchmark stopping (stub)',
};

function handleRpc(handlers, req, res) {
  const { method, params, id } = req.body;
  const sourceIp = req.ip;
  const cleanIp = sourceIp.replace('::ffff:', '');

  if (!method) {
    return res.status(400).json({ result: null, error: { code: -32600, message: 'Missing method' }, id });
  }

  requestJournal.push({ method, sourceIp: cleanIp, timestamp: Date.now() });
  if (requestJournal.length > MAX_JOURNAL_SIZE) requestJournal.shift();

  if (rpcFailures.has(cleanIp)) {
    return res.json({ result: null, error: { code: -28, message: 'Loading block index...' }, id });
  }

  const lowerMethod = method.toLowerCase();
  const handler = handlers[lowerMethod];

  if (!handler) {
    console.log(`Unhandled RPC method: ${method} from ${sourceIp}`);
    return res.json({ result: null, error: { code: -32601, message: `Method not found: ${method}` }, id });
  }

  try {
    const result = typeof handler === 'function' ? handler.call(handlers, params || [], sourceIp) : handler;
    return res.json({ result, error: null, id });
  } catch (e) {
    console.error(`RPC error for ${method} from ${sourceIp}:`, e.message);
    return res.json({ result: null, error: { code: -1, message: e.message }, id });
  }
}

// -- Fluxd RPC server --
const fluxd = express();
fluxd.use(express.json());
fluxd.post('/', (req, res) => handleRpc(rpcHandlers, req, res));
fluxd.listen(FLUXD_PORT, () => console.log(`Fluxd stub listening on port ${FLUXD_PORT}`));

// -- Fluxbenchd RPC server --
const benchd = express();
benchd.use(express.json());
benchd.post('/', (req, res) => handleRpc(benchHandlers, req, res));
benchd.listen(BENCHD_PORT, () => console.log(`Fluxbenchd stub listening on port ${BENCHD_PORT}`));

// -- Block ticker --
const BLOCK_INTERVAL_MS = Number(process.env.BLOCK_INTERVAL_MS) || 5000;
const TICKER_AUTOSTART = process.env.TICKER_AUTOSTART !== 'false';
const pendingAppTxQueue = [];
let tickerHandle = null;

function tickBlock() {
  currentHeight += 1;
  const txs = [];
  while (pendingAppTxQueue.length > 0) {
    const appHash = pendingAppTxQueue.shift();
    txs.push(buildAppRegistrationTx(appHash, currentHeight));
  }
  if (txs.length > 0) {
    pendingBlocks.push({
      hash: `000000000000stub${currentHeight}`,
      confirmations: 1,
      size: 1000,
      height: currentHeight,
      version: 4,
      merkleroot: '0000000000000000000000000000000000000000000000000000000000000000',
      tx: txs,
      time: Math.floor(Date.now() / 1000),
      nonce: 0,
      difficulty: 1000,
      previousblockhash: `000000000000stub${currentHeight - 1}`,
    });
    console.log(`Block ${currentHeight}: ${txs.length} app tx(s)`);
  }
}

function startTicker() {
  if (tickerHandle) return false;
  tickerHandle = setInterval(tickBlock, BLOCK_INTERVAL_MS);
  console.log(`Block ticker started (${BLOCK_INTERVAL_MS}ms interval)`);
  return true;
}

function stopTicker() {
  if (!tickerHandle) return false;
  clearInterval(tickerHandle);
  tickerHandle = null;
  console.log('Block ticker stopped');
  return true;
}

if (TICKER_AUTOSTART) {
  startTicker();
} else {
  console.log('Block ticker paused (TICKER_AUTOSTART=false). POST /ticker/start to begin.');
}

// -- Test harness control API --
const control = express();
control.use(express.json());

control.get('/state', (req, res) => {
  res.json({
    currentHeight,
    nodeCount: deterministicNodeList.length,
    pendingBlocks: pendingBlocks.length,
    pendingAppTxQueue: pendingAppTxQueue.length,
    blockIntervalMs: BLOCK_INTERVAL_MS,
    tickerRunning: tickerHandle !== null,
    statusOverrides: nodeStatusOverrides.size,
    rpcFailures: rpcFailures.size,
  });
});

control.post('/ticker/start', (req, res) => {
  const started = startTicker();
  res.json({ tickerRunning: true, started });
});

control.post('/ticker/stop', (req, res) => {
  const stopped = stopTicker();
  res.json({ tickerRunning: false, stopped });
});

function buildAppRegistrationTx(appHash, height) {
  const opReturnHex = Buffer.from(appHash, 'utf-8').toString('hex');
  return {
    txid: `apptx-${appHash.substring(0, 16)}-${height}`,
    version: 1,
    vin: [{ txid: 'prev-tx-stub', vout: 0, address: 'stub-sender-address' }],
    vout: [
      {
        valueSat: 200000000,
        scriptPubKey: {
          addresses: ['t3NryfAQLGeFs9jEoeqsxmBN2QLRaRKFLUX'],
          asm: '',
        },
      },
      {
        valueSat: 0,
        scriptPubKey: {
          addresses: [],
          asm: `OP_RETURN ${opReturnHex}`,
        },
      },
    ],
  };
}

control.post('/advance-block', (req, res) => {
  const { block, appHash } = req.body;
  currentHeight += 1;
  const txs = [];
  if (appHash) {
    txs.push(buildAppRegistrationTx(appHash, currentHeight));
  }
  while (pendingAppTxQueue.length > 0) {
    txs.push(buildAppRegistrationTx(pendingAppTxQueue.shift(), currentHeight));
  }
  if (block) {
    block.height = block.height || currentHeight;
    block.hash = block.hash || `000000000000stub${currentHeight}`;
    block.confirmations = 1;
    block.tx = [...(block.tx || []), ...txs];
    pendingBlocks.push(block);
  } else if (txs.length > 0) {
    pendingBlocks.push({
      hash: `000000000000stub${currentHeight}`,
      confirmations: 1,
      size: 1000,
      height: currentHeight,
      version: 4,
      merkleroot: '0000000000000000000000000000000000000000000000000000000000000000',
      tx: txs,
      time: Math.floor(Date.now() / 1000),
      nonce: 0,
      difficulty: 1000,
      previousblockhash: `000000000000stub${currentHeight - 1}`,
    });
    console.log(`Block ${currentHeight}: ${txs.length} app tx(s) (manual advance)`);
  }
  res.json({ currentHeight });
});

control.post('/set-height', (req, res) => {
  currentHeight = req.body.height;
  res.json({ currentHeight });
});

control.post('/set-node-list', (req, res) => {
  deterministicNodeList = req.body.nodes;
  res.json({ nodeCount: deterministicNodeList.length });
});

control.post('/queue-app-tx', (req, res) => {
  const { appHash } = req.body;
  if (!appHash) return res.status(400).json({ error: 'appHash required' });
  pendingAppTxQueue.push(appHash);
  return res.json({ queued: true, queueLength: pendingAppTxQueue.length, nextBlockHeight: currentHeight + 1 });
});

control.post('/add-block-fixture', (req, res) => {
  pendingBlocks.push(req.body.block);
  res.json({ pendingBlocks: pendingBlocks.length });
});

control.delete('/pending-blocks', (req, res) => {
  pendingBlocks = [];
  res.json({ cleared: true });
});

// -- Per-node status overrides --

control.post('/node-status/:ip', (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  nodeStatusOverrides.set(req.params.ip, { status });
  return res.json({ ip: req.params.ip, status });
});

control.delete('/node-status/:ip', (req, res) => {
  nodeStatusOverrides.delete(req.params.ip);
  res.json({ ip: req.params.ip, cleared: true });
});

control.post('/node-status/all', (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  for (const node of deterministicNodeList) {
    nodeStatusOverrides.set(node.ip.split(':')[0], { status });
  }
  res.json({ status, count: deterministicNodeList.length });
});

control.delete('/node-status/all', (req, res) => {
  nodeStatusOverrides.clear();
  res.json({ cleared: true });
});

control.get('/node-status', (req, res) => {
  res.json(Object.fromEntries(nodeStatusOverrides));
});

// -- Deterministic list manipulation --

control.post('/node-list/remove/:ip', (req, res) => {
  const ip = req.params.ip;
  const before = deterministicNodeList.length;
  deterministicNodeList = deterministicNodeList.filter((n) => n.ip.split(':')[0] !== ip);
  res.json({ ip, removed: deterministicNodeList.length < before, nodeCount: deterministicNodeList.length });
});

control.post('/node-list/restore/:ip', (req, res) => {
  const ip = req.params.ip;
  const original = originalNodeList.find((n) => n.ip.split(':')[0] === ip);
  if (!original) return res.status(404).json({ error: `${ip} not in original list` });
  const exists = deterministicNodeList.some((n) => n.ip.split(':')[0] === ip);
  if (!exists) deterministicNodeList.push(original);
  return res.json({ ip, restored: !exists, nodeCount: deterministicNodeList.length });
});

control.post('/node-list/reset', (req, res) => {
  deterministicNodeList = [...originalNodeList];
  res.json({ nodeCount: deterministicNodeList.length });
});

// -- Per-node tier control --

control.post('/node-tier/:ip', (req, res) => {
  const ip = req.params.ip;
  const { tier } = req.body;
  if (!tier || !['CUMULUS', 'NIMBUS', 'STRATUS'].includes(tier)) {
    return res.status(400).json({ error: 'tier must be CUMULUS, NIMBUS, or STRATUS' });
  }
  const node = deterministicNodeList.find((n) => n.ip.split(':')[0] === ip);
  if (!node) return res.status(404).json({ error: `node ${ip} not found` });
  node.tier = tier;
  const amounts = { CUMULUS: 1000, NIMBUS: 12500, STRATUS: 40000 };
  return res.json({ ip, tier, collateral: amounts[tier] });
});

// -- RPC failure simulation --

control.post('/rpc-fail/:ip', (req, res) => {
  rpcFailures.set(req.params.ip, true);
  res.json({ ip: req.params.ip, rpcFailing: true });
});

control.delete('/rpc-fail/:ip', (req, res) => {
  rpcFailures.delete(req.params.ip);
  res.json({ ip: req.params.ip, rpcFailing: false });
});

control.post('/rpc-fail/all', (req, res) => {
  for (const node of deterministicNodeList) {
    rpcFailures.set(node.ip.split(':')[0], true);
  }
  res.json({ rpcFailing: true, count: deterministicNodeList.length });
});

control.delete('/rpc-fail/all', (req, res) => {
  rpcFailures.clear();
  res.json({ rpcFailing: false, cleared: true });
});

// -- Seeded RPC data --

control.post('/seed-address-deltas', (req, res) => {
  const { deltas } = req.body;
  if (!Array.isArray(deltas)) return res.status(400).json({ error: 'deltas must be an array' });
  seededAddressDeltas.push(...deltas);
  return res.json({ count: seededAddressDeltas.length });
});

control.post('/seed-address-txids', (req, res) => {
  const { txids } = req.body;
  if (!Array.isArray(txids)) return res.status(400).json({ error: 'txids must be an array' });
  seededAddressTxids.push(...txids);
  return res.json({ count: seededAddressTxids.length });
});

control.post('/seed-transaction', (req, res) => {
  const { txid, tx } = req.body;
  if (!txid || !tx) return res.status(400).json({ error: 'txid and tx required' });
  seededTransactions.set(txid, tx);
  return res.json({ txid, seeded: true, count: seededTransactions.size });
});

control.delete('/seed-data', (req, res) => {
  seededAddressDeltas.length = 0;
  seededAddressTxids.length = 0;
  seededTransactions.clear();
  res.json({ cleared: true });
});

// -- Reset all overrides --

control.post('/reset', (req, res) => {
  nodeStatusOverrides.clear();
  rpcFailures.clear();
  deterministicNodeList = [...originalNodeList];
  pendingBlocks = [];
  pendingAppTxQueue.length = 0;
  requestJournal.length = 0;
  seededAddressDeltas.length = 0;
  seededAddressTxids.length = 0;
  seededTransactions.clear();
  res.json({ reset: true, nodeCount: deterministicNodeList.length });
});

// -- Request journal --

control.get('/journal', (req, res) => {
  const { method, sourceIp, limit = 100 } = req.query;
  let entries = requestJournal;
  if (method) entries = entries.filter((e) => e.method.toLowerCase() === method.toLowerCase());
  if (sourceIp) entries = entries.filter((e) => e.sourceIp === sourceIp);
  res.json({ total: entries.length, entries: entries.slice(-Number(limit)) });
});

control.delete('/journal', (req, res) => {
  requestJournal.length = 0;
  res.json({ cleared: true });
});

control.listen(CONTROL_PORT, () => console.log(`Control API listening on port ${CONTROL_PORT}`));
