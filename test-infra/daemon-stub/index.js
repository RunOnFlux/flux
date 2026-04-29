const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const FLUXD_PORT = Number(process.env.FLUXD_PORT) || 16124;
const BENCHD_PORT = Number(process.env.BENCHD_PORT) || 16224;
const CONTROL_PORT = Number(process.env.CONTROL_PORT) || 18232;

let currentHeight = Number(process.env.INITIAL_HEIGHT) || 2100000;
let deterministicNodeList = [];
let pendingBlocks = [];

const fixturesDir = process.env.FIXTURES_DIR || path.join(__dirname, '..', 'fixtures');

try {
  const listPath = path.join(fixturesDir, 'deterministic-list.json');
  if (fs.existsSync(listPath)) {
    deterministicNodeList = JSON.parse(fs.readFileSync(listPath, 'utf-8'));
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

    const pending = pendingBlocks.find((b) => b.height === hashOrHeight || b.hash === hashOrHeight);
    if (pending) return pending;

    const height = typeof hashOrHeight === 'number' ? hashOrHeight : currentHeight;
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
    return {
      status: 'CONFIRMED',
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
    if (verbose) {
      return {
        txid,
        version: 1,
        locktime: 0,
        vin: [],
        vout: [],
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
  getaddresstxids: () => [],
  getaddressdeltas: () => [],

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
      ipaddress: node ? node.ip.split(':')[0] : '127.0.0.1',
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

  help: () => 'Flux benchmark stub',
  stop: () => 'Flux benchmark stopping (stub)',
};

function handleRpc(handlers, req, res) {
  const { method, params, id } = req.body;
  const sourceIp = req.ip;

  if (!method) {
    return res.status(400).json({ result: null, error: { code: -32600, message: 'Missing method' }, id });
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

// -- Test harness control API --
const control = express();
control.use(express.json());

control.get('/state', (req, res) => {
  res.json({ currentHeight, nodeCount: deterministicNodeList.length, pendingBlocks: pendingBlocks.length });
});

control.post('/advance-block', (req, res) => {
  const { block } = req.body;
  currentHeight += 1;
  if (block) {
    block.height = block.height || currentHeight;
    block.hash = block.hash || `000000000000stub${currentHeight}`;
    block.confirmations = 1;
    pendingBlocks.push(block);
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

control.post('/add-block-fixture', (req, res) => {
  pendingBlocks.push(req.body.block);
  res.json({ pendingBlocks: pendingBlocks.length });
});

control.delete('/pending-blocks', (req, res) => {
  pendingBlocks = [];
  res.json({ cleared: true });
});

control.listen(CONTROL_PORT, () => console.log(`Control API listening on port ${CONTROL_PORT}`));
