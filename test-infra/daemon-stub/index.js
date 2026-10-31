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

// Reported software versions — single source of truth so every RPC stays consistent
// and a version bump is a one-line change. BENCH_VERSION must satisfy FluxOS's
// config.minimumFluxBenchAllowedVersion (currently 6.2.0) or the node DOS-flags itself.
const DAEMON_VERSION = 6010050;
const DAEMON_PROTOCOL_VERSION = 170019;
const DAEMON_WALLET_VERSION = 60000;
const DAEMON_SUBVERSION = '/Flux:6.1.0/';
const BENCH_VERSION = '6.3.1';
const FLUX_VERSION = '8.0.0';

// No fallback on purpose. This was a third copy of the chain start and it was
// the stale one, so any path that started the stub without the variable put the
// whole chain below the v8 fork and ran every suite on the pre-fork branch of
// every rule keyed on it - silently, and looking exactly like a product bug.
// The chain start has one home (runner/framework/chain-start.cjs) and test-env
// always passes it; a stub started without it is misconfigured, not defaulted.
if (!process.env.INITIAL_HEIGHT) {
  throw new Error('daemon-stub: INITIAL_HEIGHT is required - the chain start comes from runner/framework/chain-start.cjs, never from a default here');
}
let currentHeight = Number(process.env.INITIAL_HEIGHT);
let deterministicNodeList = [];
let originalNodeList = [];
let pendingBlocks = [];
// height -> block time, epoch seconds. A block's time is fixed when it is mined,
// or when it is first asked about if it predates this stub, and every later read
// returns the same value - as the chain does, where every node reads one header
// time for a block whenever it fetches it.
const blockTimes = new Map();

function blockTimeOf(height) {
  if (!blockTimes.has(height)) blockTimes.set(height, Math.floor(Date.now() / 1000));
  return blockTimes.get(height);
}

const nodeStatusOverrides = new Map();
const rpcFailures = new Map();
// ip -> Map(method -> Set(resolve)). A held method does not answer until the suite
// releases it. Failing an RPC ends the operation waiting on it; holding one keeps
// that operation open, which is how a suite decides when it is in flight.
const rpcHolds = new Map();
// One method failing for one node: ip -> method -> how many more calls fail.
const rpcMethodFailures = new Map();
// ip -> false. Absent means ArcaneOS, which is what 85% of the real fleet runs
// and what every suite that does not care about this should see: a node reading
// systemsecure=true is never a residential-DOS target.
const nonArcaneNodes = new Map();
const requestJournal = [];
const MAX_JOURNAL_SIZE = 10000;

const seededAddressDeltas = [];
const seededAddressTxids = [];
const seededTransactions = new Map();

const fixturesDir = process.env.FIXTURES_DIR || path.join(__dirname, '..', 'fixtures');

const NODE_COUNT = Number(process.env.NODE_COUNT) || 16;

// Default-base baseline from the committed fixture. The harness assigns per-run
// addresses and POSTs the rendered list to /set-node-list (which also resets this
// baseline), so the IP convention lives only in runner/framework/subnet-config.js.
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
  const listed = deterministicNodeList.find((n) => n.ip.split(':')[0] === clean);
  if (listed) return listed;
  // A node that has really moved arrives from its NEW address while its list entry
  // still says where it was - which is exactly the state an address change puts it
  // in, before the chain catches up. It is the same node, and failing to recognise
  // it here costs it its own identity: every answer about it falls back to the
  // not-found defaults, so it reads its own address as 127.0.0.1, decides it is not
  // in the confirmed list, and skips the availability check that would have told it
  // what happened.
  for (const [realIp, override] of reportedAddresses) {
    if (String(override.reported).split(':')[0] === clean) {
      return deterministicNodeList.find((n) => n.ip.split(':')[0] === realIp) || null;
    }
  }
  // Nor is it anyone else once it is told a further move: until its container
  // moves again it still arrives from the address it was moved to before.
  for (const [realIp, former] of formerReportedAddresses) {
    if (former.has(clean)) return deterministicNodeList.find((n) => n.ip.split(':')[0] === realIp) || null;
  }
  // A machine running on another node's collateral is answered as that node: its
  // collateral, its status and its list entry are the ones the chain holds.
  const alias = collateralAliases.get(clean);
  if (alias) return deterministicNodeList.find((n) => n.ip.split(':')[0] === alias) || null;
  // A node the list no longer holds is still the machine it was: its own daemon
  // and benchmark answer with its collateral, key and address. Only the list,
  // and what a mined confirmation changes, leave it out.
  return originalNodeList.find((n) => n.ip.split(':')[0] === clean) || null;
}

// Machines that run on another node's collateral: real ip -> the real ip of the
// listed node they run as. Each is a machine of its own all the same, so what its
// benchmark measures, and what its confirmation carries, is its own address.
const collateralAliases = new Map();

// The address benchmark measures for the machine a request comes from, or null
// when it is not one running on another node's collateral.
function aliasedOwnAddress(sourceIp, node) {
  const clean = sourceIp.replace('::ffff:', '');
  if (!collateralAliases.has(clean) || !node) return null;
  const [, port] = node.ip.split(':');
  return port ? `${clean}:${port}` : clean;
}

// Where a node really is, versus where the network is told it is.
//
// A node's list entry carries ONE address and the stub uses it for two different
// jobs: matching the address a request ARRIVES from, to work out whose request it
// is, and answering every chain-facing question about where that node lives.
// Moving the second by editing the entry breaks the first - the node stops being
// findable by its own requests - so the override sits beside the list, keyed by
// where the node really is, and only the ANSWERS move. The container keeps its
// address and nothing is renumbered underneath it.
//
// Every answer that names a node's address reads through here: getbenchmarks
// (which is what a node's own getLocalSocketAddress reads, and so what it believes
// about itself), getpublicip, its status, and the deterministic list the network is
// served. One dial rather than one per RPC - a suite that moves an address means
// all of them, and a per-RPC dial is how a suite comes to move an answer the
// product never reads.
const reportedAddresses = new Map(); // real ip -> { reported, scope }
// The addresses each node was reported at before the one it is reported at now:
// real ip -> Set of ips.
const formerReportedAddresses = new Map();

// Reports the node at real ip `key` at `override`, keeping the address it was
// reported at before as one of its own.
function reportAddress(key, override) {
  const before = reportedAddresses.get(key);
  if (before && before.reported !== override.reported) {
    if (!formerReportedAddresses.has(key)) formerReportedAddresses.set(key, new Set());
    formerReportedAddresses.get(key).add(String(before.reported).split(':')[0]);
  }
  reportedAddresses.set(key, override);
}

// Two facts, and a real address change separates them for as long as it takes the
// chain to catch up: where the network says the node lives, and what benchmark's
// public-IP probe reads right now. `all` moves both. `publicip` moves only the
// probe - benchmark still reports the old address as the node's own, the node is
// still listed there, and only getpublicip has noticed. That is the state a node
// is actually in when its address moves, and it is what lets it detect the move at
// all: the two answers disagreeing IS the detection. `benchmark` is the state after
// it: benchmark reports the new address as the node's own, and the network still
// lists it at the old one.
function overrideFor(node) {
  if (!node) return null;
  return reportedAddresses.get(node.ip.split(':')[0]) || null;
}

// Where the chain lists the node at real ip `key`, or null where it lists it at
// its own address: an `all` override's address, or the one a mined confirmation
// listed it at while benchmark reports another. What benchmark reports never
// moves it; only a mined confirmation does.
function listedAddressFor(key) {
  const o = reportedAddresses.get(key);
  if (!o) return null;
  return o.scope === 'all' ? o.reported : (o.listed ?? null);
}

// The address the network believes this node has.
function reportedAddressOf(node) {
  if (!node) return null;
  return listedAddressFor(node.ip.split(':')[0]) ?? node.ip;
}

// The address benchmark tells the node it has. Moves under `benchmark` and `all`.
function benchmarkAddressOf(node) {
  if (!node) return null;
  const o = overrideFor(node);
  return o && (o.scope === 'all' || o.scope === 'benchmark') ? o.reported : node.ip;
}

// What benchmark's public-IP probe answers, which moves under either scope.
function publicIpAnswerFor(node) {
  if (!node) return null;
  const o = overrideFor(node);
  return (o ? o.reported : node.ip).split(':')[0];
}

// Nodes hidden from their PEERS' view of the network, but never from their own.
//
// This is what makes a node unreachable to the fleet deterministically. Asked
// whether it can reach a node, a peer consults its node list FIRST and answers
// "not available" outright when the address is not in it - no probe, no timeout,
// no dependence on how fast anything answers. Blocking packets instead only makes
// the probe slow, and a slow probe is a different answer from an absent one: the
// asker times out on the PEER and never learns it is unreachable.
//
// The node still sees ITSELF, because it has its own confirmed-list gate to pass
// before it will run the availability check at all. Hiding it from everyone,
// itself included, stops the check ever running.
const hiddenFromPeers = new Set(); // real ip -> hidden from other nodes' lists
// Nodes benchmark has no address for, as fluxbench has none when no public-IP
// service answers it: getbenchmarks reports none and getpublicip fails.
const unresolvedNodes = new Set(); // real ip

// The list as a given requester sees it: every entry at its reported address,
// minus any node hidden from that requester. A run with nothing hidden and nothing
// moved serves the very same objects it always did.
function publishedNodeList(sourceIp) {
  const asker = sourceIp ? sourceIp.replace('::ffff:', '') : null;
  const visible = hiddenFromPeers.size
    ? deterministicNodeList.filter((n) => {
      const ip = n.ip.split(':')[0];
      return !hiddenFromPeers.has(ip) || ip === asker;
    })
    : deterministicNodeList;
  return publishReported(visible);
}

function publishReported(list) {
  return list.map((n) => {
    const listedAt = listedAddressFor(n.ip.split(':')[0]);
    const entry = withLastConfirmed(n);
    return listedAt ? { ...entry, ip: listedAt } : entry;
  });
}

/**
 * The address-index deltas of the blocks this stub has built: one per output
 * paying a requested address, with the transaction's position in its block as
 * `blockindex`, as fluxd reports them.
 * @param {{addresses?: string[], start?: number, end?: number}} query
 * @returns {object[]}
 */
function blockAddressDeltas({ addresses = [], start = 0, end = Infinity }) {
  const wanted = new Set(addresses);
  const deltas = [];
  pendingBlocks
    .filter((block) => block.height >= start && block.height <= end)
    .sort((a, b) => a.height - b.height)
    .forEach((block) => {
      (block.tx || []).forEach((tx, blockindex) => {
        (tx.vout || []).forEach((vout, index) => {
          const address = vout.scriptPubKey?.addresses?.[0];
          if (!wanted.has(address)) return;
          deltas.push({
            satoshis: vout.valueSat, txid: tx.txid, index, blockindex, height: block.height, address,
          });
        });
      });
    });
  return deltas;
}

// Nodes whose daemon is behind the chain's tip, as one catching up or
// re-syncing is: real ip -> the height it holds as its own.
const daemonsBehind = new Map();

// The height the daemon serving `sourceIp` holds: its own while it is behind,
// the chain's tip otherwise.
function localHeightFor(sourceIp) {
  const node = sourceIp ? nodeBySourceIp(sourceIp) : null;
  const behind = node ? daemonsBehind.get(node.ip.split(':')[0]) : undefined;
  return behind === undefined ? currentHeight : Math.min(behind, currentHeight);
}

const rpcHandlers = {
  // headers is the chain's tip whatever the daemon holds: a daemon behind it
  // knows the headers before it has the blocks.
  getblockchaininfo: (params, sourceIp) => ({
    chain: 'main',
    blocks: localHeightFor(sourceIp),
    headers: currentHeight,
    bestblockhash: `000000000000stub${localHeightFor(sourceIp)}`,
    difficulty: 1000,
    verificationprogress: 1,
    chainwork: '0000000000000000000000000000000000000000000000000000000000000001',
  }),

  getblockcount: (params, sourceIp) => localHeightFor(sourceIp),

  getinfo: () => ({
    version: DAEMON_VERSION,
    protocolversion: DAEMON_PROTOCOL_VERSION,
    walletversion: DAEMON_WALLET_VERSION,
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
    version: DAEMON_VERSION,
    subversion: DAEMON_SUBVERSION,
    protocolversion: DAEMON_PROTOCOL_VERSION,
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

  getbestblockhash: (params, sourceIp) => `000000000000stub${localHeightFor(sourceIp)}`,

  getblockhash: (params) => {
    const height = params[0];
    return `000000000000stub${height}`;
  },

  getblock: (params) => {
    const hashOrHeight = params[0];
    const verbosity = params[1] || 1;
    const asNum = Number(hashOrHeight);

    const pending = pendingBlocks.find((b) => b.height === asNum || b.height === hashOrHeight || b.hash === hashOrHeight);
    if (pending) {
      const confirmations = verbosity === 2 ? fluxnodeTxsAt(pending.height) : [];
      return confirmations.length ? { ...pending, tx: [...(pending.tx || []), ...confirmations] } : pending;
    }

    const height = !Number.isNaN(asNum) ? asNum : currentHeight;
    const block = {
      hash: `000000000000stub${height}`,
      confirmations: currentHeight - height + 1,
      size: 1000,
      height,
      version: 4,
      merkleroot: '0000000000000000000000000000000000000000000000000000000000000000',
      tx: [],
      time: blockTimeOf(height),
      nonce: 0,
      difficulty: 1000,
      previousblockhash: height > 0 ? `000000000000stub${height - 1}` : undefined,
      nextblockhash: height < currentHeight ? `000000000000stub${height + 1}` : undefined,
    };

    if (verbosity === 2) {
      block.tx = fluxnodeTxsAt(height);
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
      time: blockTimeOf(currentHeight),
    };
  },

  getmempoolinfo: () => ({ size: 0, bytes: 0, usage: 0 }),
  getrawmempool: () => [],

  viewdeterministiczelnodelist: (params, sourceIp) => publishedNodeList(sourceIp),
  viewdeterministicfluxnodelist: (params, sourceIp) => publishedNodeList(sourceIp),

  getzelnodestatus: (params, sourceIp) => {
    const node = nodeBySourceIp(sourceIp);
    const clean = sourceIp.replace('::ffff:', '');
    const override = nodeStatusOverrides.get(clean);
    return {
      status: override?.status ?? 'CONFIRMED',
      collateral: node ? node.collateral : 'COutPoint(0000000000000000000000000000000000000000000000000000000000000000, 0)',
      txhash: node ? node.txhash : '0000000000000000000000000000000000000000000000000000000000000000',
      outidx: node ? node.outidx : '0',
      ip: node ? reportedAddressOf(node) : '127.0.0.1',
      network: '',
      added_height: node ? node.added_height : currentHeight - 1000,
      confirmed_height: node ? node.confirmed_height : currentHeight - 500,
      last_confirmed_height: node ? withLastConfirmed(node).last_confirmed_height : currentHeight - 10,
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

  listfluxnodes: (params, sourceIp) => publishedNodeList(sourceIp),
  listzelnodes: (params, sourceIp) => publishedNodeList(sourceIp),

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

  // A confirmation carries the address fluxbench measured for the node, and the
  // next block mines it: the node's list entry and status move there then.
  createconfirmationtransaction: (params, sourceIp) => {
    const node = nodeBySourceIp(sourceIp);
    if (node) {
      const o = overrideFor(node);
      pendingConfirmations.set(node.ip.split(':')[0], aliasedOwnAddress(sourceIp, node) ?? (o ? o.reported : node.ip));
    }
    return { hex: 'stub-confirmation-tx-hex' };
  },

  getaddressbalance: () => ({ balance: 0, received: 0 }),
  getaddressutxos: () => [],
  getaddresstxids: () => (seededAddressTxids.length > 0 ? seededAddressTxids : []),
  getaddressdeltas: (params) => [...seededAddressDeltas, ...blockAddressDeltas(params[0] || {})],

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
    const unresolved = node && unresolvedNodes.has(node.ip.split(':')[0]);
    return {
      ipaddress: unresolved ? '' : (node ? (aliasedOwnAddress(sourceIp, node) ?? benchmarkAddressOf(node)) : '127.0.0.1'),
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
      bench_version: BENCH_VERSION,
      flux_version: FLUX_VERSION,
      architecture: 'amd64',
      // The ArcaneOS attestation residentialNodeDosService reads. A node absent
      // from the override map is attested.
      systemsecure: !nonArcaneNodes.has(node ? node.ip.split(':')[0] : ''),
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
    if (node && unresolvedNodes.has(node.ip.split(':')[0])) throw new Error('Ipaddress gathered is not valid: ');
    const own = aliasedOwnAddress(sourceIp, node);
    if (own) return own.split(':')[0];
    // fluxbench keeps the address getpublicip measures as its own: getbenchmarks
    // reports it from then on.
    const o = overrideFor(node);
    if (o && o.scope === 'publicip') o.scope = 'benchmark';
    return node ? publicIpAnswerFor(node) : '127.0.0.1';
  },

  getpublickey: (params, sourceIp) => {
    const node = nodeBySourceIp(sourceIp);
    return node ? node.pubkey : 'stub-pubkey';
  },

  getinfo: () => ({
    version: BENCH_VERSION,
    rpcport: BENCHD_PORT,
  }),

  decryptrsamessage: () => JSON.stringify({
    status: 'ok',
    message: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  }),

  help: () => 'Flux benchmark stub',
  stop: () => 'Flux benchmark stopping (stub)',
};

async function handleRpc(handlers, req, res) {
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

  const failing = rpcMethodFailures.get(cleanIp);
  if (failing && failing.get(lowerMethod) > 0) {
    failing.set(lowerMethod, failing.get(lowerMethod) - 1);
    return res.json({ result: null, error: { code: -1, message: `${lowerMethod} failed by the harness` }, id });
  }

  const heldMethods = rpcHolds.get(cleanIp);
  const waiters = heldMethods && heldMethods.get(lowerMethod);
  if (waiters) {
    await new Promise((resolve) => { waiters.add(resolve); });
  }

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
fluxd.post('/', (req, res) => { handleRpc(rpcHandlers, req, res).catch((err) => { console.error('fluxd rpc:', err); }); });
fluxd.listen(FLUXD_PORT, () => console.log(`Fluxd stub listening on port ${FLUXD_PORT}`));

// -- Fluxbenchd RPC server --
const benchd = express();
benchd.use(express.json());
benchd.post('/', (req, res) => { handleRpc(benchHandlers, req, res).catch((err) => { console.error('benchd rpc:', err); }); });
benchd.listen(BENCHD_PORT, () => console.log(`Fluxbenchd stub listening on port ${BENCHD_PORT}`));

// Confirmations sent since the last block: real ip -> the address each carries.
const pendingConfirmations = new Map();
// The fluxnode confirmations each built block carries, by height, and the block
// each node last confirmed in (real ip -> height).
const fluxnodeTxsByHeight = new Map();
const lastConfirmedHeights = new Map();
const FLUXNODE_TXS_KEPT = 1000;

// HOW OFTEN A NODE CONFIRMS. fluxd has a node confirm 500 to 640 blocks after
// its last confirmation (FLUXNODE_CONFIRM_UPDATE_MIN_HEIGHT_V3 and
// _EXPIRATION_HEIGHT_V4); a confirmation carrying a new address is sent at
// once. Here a node confirms every CONFIRMATION_INTERVAL_BLOCKS (default 1)
// after its last confirmation, at its own offset in the list, and a
// confirmation it sends is mined in the next block. A schedule set for one
// node through /confirmation-schedule replaces the fleet's interval for it.
const CONFIRMATION_INTERVAL_BLOCKS = Number(process.env.CONFIRMATION_INTERVAL_BLOCKS) || 1;
const STARTED_AT_HEIGHT = currentHeight;
// real ip -> interval, for a node given its own schedule
const confirmationIntervals = new Map();
// real ip -> the height its next confirmation is due at
const confirmationDue = new Map();

const realIpOf = (node) => node.ip.split(':')[0];
const intervalOf = (node) => confirmationIntervals.get(realIpOf(node)) ?? CONFIRMATION_INTERVAL_BLOCKS;
// The first height at or above `height` at the node's offset in the fleet's interval.
function scheduledFrom(node, height) {
  const offset = deterministicNodeList.indexOf(node) % CONFIRMATION_INTERVAL_BLOCKS;
  return height + ((((offset - height) % CONFIRMATION_INTERVAL_BLOCKS) + CONFIRMATION_INTERVAL_BLOCKS) % CONFIRMATION_INTERVAL_BLOCKS);
}

function confirmationTx(node, height, ip) {
  return {
    txid: `stubconfirm${height}${node.txhash}`,
    version: 5,
    type: 'Confirming a fluxnode',
    collateral: node.collateral,
    txhash: node.txhash,
    outidx: node.outidx,
    ip,
    update_type: 1,
    vin: [],
    vout: [],
  };
}

// The confirmations a block carries. A block from before this stub started
// carries the fleet schedule's, at each node's listed address, so an explorer
// that starts at the fleet's first block knows every node within one interval;
// at an interval of one block the first block mined confirms every node.
function fluxnodeTxsAt(height) {
  if (fluxnodeTxsByHeight.has(height)) return fluxnodeTxsByHeight.get(height);
  if (CONFIRMATION_INTERVAL_BLOCKS === 1 || height > STARTED_AT_HEIGHT) return [];
  return deterministicNodeList
    .filter((node) => scheduledFrom(node, height) === height)
    .map((node) => confirmationTx(node, height, node.ip));
}

// Mine the confirmations due in this block: every node that sent one since the
// last block, and every node whose interval has run. One carrying an address
// other than the node's own moves its list entry and status there, as a node's
// IP-change confirmation does on chain; one carrying the address it already
// has moves an entry an earlier one moved back.
function mineConfirmations() {
  // eslint-disable-next-line no-restricted-syntax
  for (const [realIp, address] of pendingConfirmations) {
    const node = deterministicNodeList.find((n) => n.ip.split(':')[0] === realIp);
    const current = reportedAddresses.get(realIp);
    // Benchmark reporting another address than the one mined leaves it there:
    // the confirmation moves the list entry alone.
    const benchmarkElsewhere = current && current.scope !== 'all' && current.reported !== address;
    if (!node) {
      // not listed: nothing to move
    } else if (address !== node.ip) {
      if (benchmarkElsewhere) reportedAddresses.set(realIp, { ...current, listed: address });
      else reportAddress(realIp, { reported: address, scope: 'all' });
    } else if (current?.scope === 'all' || current?.reported === node.ip) {
      reportedAddresses.delete(realIp);
      formerReportedAddresses.delete(realIp);
    } else if (current) {
      const { listed, ...benchmarkOnly } = current;
      reportedAddresses.set(realIp, benchmarkOnly);
    }
  }
  const confirming = deterministicNodeList.filter((node) => pendingConfirmations.has(realIpOf(node))
    || currentHeight >= (confirmationDue.get(realIpOf(node)) ?? scheduledFrom(node, currentHeight)));
  pendingConfirmations.clear();
  fluxnodeTxsByHeight.set(currentHeight, confirming.map((node) => {
    lastConfirmedHeights.set(realIpOf(node), currentHeight);
    confirmationDue.set(realIpOf(node), currentHeight + intervalOf(node));
    return confirmationTx(node, currentHeight, reportedAddressOf(node));
  }));
  fluxnodeTxsByHeight.delete(currentHeight - FLUXNODE_TXS_KEPT);
}

// A list entry as fluxd reports it, last_confirmed_height the block that last
// confirmed the node.
function withLastConfirmed(node) {
  const height = lastConfirmedHeights.get(node.ip.split(':')[0]);
  return height === undefined ? node : { ...node, last_confirmed_height: height };
}

// -- Block ticker --
const BLOCK_INTERVAL_MS = Number(process.env.BLOCK_INTERVAL_MS) || 5000;
const TICKER_AUTOSTART = process.env.TICKER_AUTOSTART !== 'false';
const pendingAppTxQueue = [];
let tickerHandle = null;

function tickBlock() {
  currentHeight += 1;
  blockTimeOf(currentHeight);
  mineConfirmations();
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
      time: blockTimeOf(currentHeight),
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
    nonArcaneNodes: [...nonArcaneNodes.keys()],
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
  blockTimeOf(currentHeight);
  mineConfirmations();
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
    block.time = block.time ?? blockTimeOf(block.height);
    // Computed live, the way a synthesized block computes it at the top of this
    // file. Stamping 1 at push time made a block carrying transactions read as
    // the chain tip no matter how far behind the node was, while an empty block
    // did not - so the one class of block whose isSynced skip matters most, an
    // app registration, was the one class the stub had made unskippable.
    block.confirmations = currentHeight - block.height + 1;
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
      time: blockTimeOf(currentHeight),
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

// Machines that run on another node's collateral, replacing any set before:
// { aliases: { '<real ip>': '<real ip of the listed node it runs as>' } }.
control.post('/collateral-aliases', (req, res) => {
  collateralAliases.clear();
  Object.entries((req.body || {}).aliases || {}).forEach(([ip, as]) => collateralAliases.set(String(ip).split(':')[0], String(as).split(':')[0]));
  res.json({ aliases: Object.fromEntries(collateralAliases) });
});

control.post('/set-node-list', (req, res) => {
  // Update the restore/reset baseline too, so /node-list/restore and /reset stay
  // consistent with the per-run addresses the harness assigns (not the fixture's).
  deterministicNodeList = req.body.nodes;
  originalNodeList = [...req.body.nodes];
  res.json({ nodeCount: deterministicNodeList.length });
});

// Move where a node is said to be. `:ip` is where it really is - the address its
// requests arrive from, which never changes - and `reported` is the address that
// then answers for it. Sending no `reported` puts it back to the truth.
//
// `scope: 'all'` (default) moves every chain-facing answer together: benchmark's
// reply about the node itself, getpublicip, its status, and its list entry. That is
// an address change already settled everywhere.
//
// `scope: 'benchmark'` moves benchmark's public-IP probe and its reply about the
// node itself, and leaves its status and list entry where they were: a node that
// has noticed the move, before the chain has caught up.
//
// `scope: 'publicip'` moves only benchmark's public-IP probe. Everything else still
// says the node is where it was. That is the state a node is in the moment its
// address moves and before the chain has caught up. As fluxbench does, the first
// getpublicip answer moves benchmark's reply about the node itself too: the scope
// becomes `benchmark`.
// Hide a node from its PEERS' view of the network, or put it back. The node keeps
// seeing itself, which is what lets it still run the availability check that then
// comes back "unreachable" - deterministically, because a peer answers from its
// list rather than from a probe.
control.post('/node-visibility/:ip', (req, res) => {
  const key = String(req.params.ip).split(':')[0];
  const node = deterministicNodeList.find((n) => n.ip.split(':')[0] === key);
  if (!node) return res.status(404).json({ error: `no node in the list at ${key}` });
  const hidden = (req.body || {}).hidden !== false;
  if (hidden) hiddenFromPeers.add(key);
  else hiddenFromPeers.delete(key);
  return res.json({ node: key, hiddenFromPeers: hidden });
});

control.post('/benchmark-unresolved/:ip', (req, res) => {
  const key = String(req.params.ip).split(':')[0];
  const unresolved = (req.body || {}).unresolved !== false;
  if (unresolved) unresolvedNodes.add(key);
  else unresolvedNodes.delete(key);
  return res.json({ node: key, unresolved });
});

control.post('/node-address/:ip', (req, res) => {
  const key = String(req.params.ip).split(':')[0];
  const node = deterministicNodeList.find((n) => n.ip.split(':')[0] === key);
  if (!node) return res.status(404).json({ error: `no node in the list at ${key}` });

  const { reported, scope = 'all' } = req.body || {};
  if (!reported) {
    // Benchmark is back at once; a move the chain made is undone the way it
    // was made, by a confirmation the next block mines.
    const listed = listedAddressFor(key);
    if (listed) {
      reportAddress(key, { reported: node.ip, scope: 'benchmark', listed });
      pendingConfirmations.set(key, node.ip);
    } else {
      reportedAddresses.delete(key);
      formerReportedAddresses.delete(key);
    }
    return res.json({ node: key, reported: node.ip, scope: null });
  }
  if (!['all', 'benchmark', 'publicip'].includes(scope)) {
    return res.status(400).json({ error: `scope must be 'all', 'benchmark' or 'publicip', got '${scope}'` });
  }

  // A bare address keeps the node's own port. The api port is what its peers reach
  // it on, and moving that is a different change from moving the address.
  const value = String(reported);
  const realPort = node.ip.split(':')[1];
  const full = value.includes(':') || !realPort ? value : `${value}:${realPort}`;
  // Under `all` the node notices at once, as benchmark does, and the chain moves
  // its list entry when the next block mines the confirmation it sends there.
  // What benchmark reports never moves the list entry: the address the chain
  // lists the node at stays until a block mines a confirmation elsewhere.
  const listed = listedAddressFor(key);
  const keepListed = listed ? { listed } : {};
  if (scope === 'all') {
    if (reportedAddresses.get(key)?.scope !== 'all') reportAddress(key, { reported: full, scope: 'benchmark', ...keepListed });
    pendingConfirmations.set(key, full);
  } else {
    reportAddress(key, { reported: full, scope, ...keepListed });
  }
  return res.json({ node: key, reported: full, scope });
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
//
// THE LITERAL ROUTES COME FIRST, and the parameterised ones refuse the word.
// Express matches in registration order, so with '/:ip' first a DELETE of
// '/node-status/all' reached it with ip='all' and deleted the key 'all' - a
// no-op that answered { cleared: true }. Nothing failed, nothing logged, and
// four suites had been calling a clear that never cleared anything. The guard
// below is the half that makes a future reordering LOUD instead of silent.

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

control.post('/node-status/:ip', (req, res) => {
  if (req.params.ip === 'all') return res.status(500).json({ error: 'route order regressed: /node-status/all must be registered first' });
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  nodeStatusOverrides.set(req.params.ip, { status });
  return res.json({ ip: req.params.ip, status });
});

control.delete('/node-status/:ip', (req, res) => {
  if (req.params.ip === 'all') return res.status(500).json({ error: 'route order regressed: /node-status/all must be registered first' });
  nodeStatusOverrides.delete(req.params.ip);
  return res.json({ ip: req.params.ip, cleared: true });
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

// -- ArcaneOS attestation control --

control.post('/system-secure/:ip', (req, res) => {
  const { secure } = req.body;
  if (typeof secure !== 'boolean') {
    return res.status(400).json({ error: 'secure must be a boolean' });
  }
  if (secure) nonArcaneNodes.delete(req.params.ip);
  else nonArcaneNodes.set(req.params.ip, false);
  return res.json({ ip: req.params.ip, systemsecure: secure });
});

control.delete('/system-secure', (req, res) => {
  nonArcaneNodes.clear();
  res.json({ cleared: true });
});

// -- RPC failure simulation --
//
// Literal before parameterised, and the guard, for the same reason as
// /node-status above: enableAllRpcFailure and disableAllRpcFailure were both
// reaching '/rpc-fail/:ip' with ip='all' and answering success.

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

control.post('/rpc-fail/:ip', (req, res) => {
  if (req.params.ip === 'all') return res.status(500).json({ error: 'route order regressed: /rpc-fail/all must be registered first' });
  rpcFailures.set(req.params.ip, true);
  return res.json({ ip: req.params.ip, rpcFailing: true });
});

control.delete('/rpc-fail/:ip', (req, res) => {
  if (req.params.ip === 'all') return res.status(500).json({ error: 'route order regressed: /rpc-fail/all must be registered first' });
  rpcFailures.delete(req.params.ip);
  return res.json({ ip: req.params.ip, rpcFailing: false });
});

function releaseHolds(ip) {
  const heldMethods = rpcHolds.get(ip);
  if (!heldMethods) return 0;
  let released = 0;
  for (const waiters of heldMethods.values()) {
    for (const resolve of waiters) {
      resolve();
      released += 1;
    }
    waiters.clear();
  }
  rpcHolds.delete(ip);
  return released;
}

control.delete('/rpc-hold/all', (req, res) => {
  let released = 0;
  for (const ip of [...rpcHolds.keys()]) released += releaseHolds(ip);
  res.json({ held: false, released });
});

// Fail `method` for one node `times` times, then answer it as usual.
control.post('/rpc-fail-method/:ip', (req, res) => {
  const { method, times = 1 } = req.body;
  if (!method) return res.status(400).json({ error: 'method is required' });
  if (!Number.isInteger(times) || times < 1) return res.status(400).json({ error: 'times must be a positive integer' });
  const lower = String(method).toLowerCase();
  if (!rpcMethodFailures.has(req.params.ip)) rpcMethodFailures.set(req.params.ip, new Map());
  rpcMethodFailures.get(req.params.ip).set(lower, times);
  return res.json({ ip: req.params.ip, method: lower, times });
});
control.delete('/rpc-fail-method/:ip', (req, res) => {
  rpcMethodFailures.delete(req.params.ip);
  res.json({ ip: req.params.ip, cleared: true });
});

control.post('/rpc-hold/:ip', (req, res) => {
  if (req.params.ip === 'all') return res.status(500).json({ error: 'route order regressed: /rpc-hold/all must be registered first' });
  const { method } = req.body;
  if (!method) return res.status(400).json({ error: 'method is required' });
  const lower = String(method).toLowerCase();
  if (!rpcHolds.has(req.params.ip)) rpcHolds.set(req.params.ip, new Map());
  const heldMethods = rpcHolds.get(req.params.ip);
  if (!heldMethods.has(lower)) heldMethods.set(lower, new Set());
  return res.json({ ip: req.params.ip, method: lower, held: true });
});

control.delete('/rpc-hold/:ip', (req, res) => {
  if (req.params.ip === 'all') return res.status(500).json({ error: 'route order regressed: /rpc-hold/all must be registered first' });
  const released = releaseHolds(req.params.ip);
  return res.json({ ip: req.params.ip, held: false, released });
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

// A node's own confirmation schedule: every `intervalBlocks` after its last
// confirmation, the next one due at `nextHeight` (default: one interval after
// its last). An empty body returns it to the fleet's interval.
control.post('/confirmation-schedule/:ip', (req, res) => {
  const key = String(req.params.ip).split(':')[0];
  const node = deterministicNodeList.find((n) => realIpOf(n) === key);
  if (!node) return res.status(404).json({ error: `no node in the list at ${key}` });
  const { intervalBlocks, nextHeight } = req.body || {};
  if (intervalBlocks === undefined) {
    confirmationIntervals.delete(key);
    confirmationDue.delete(key);
    return res.json({ node: key, intervalBlocks: CONFIRMATION_INTERVAL_BLOCKS });
  }
  if (!Number.isInteger(intervalBlocks) || intervalBlocks < 1) {
    return res.status(400).json({ error: `intervalBlocks must be a positive integer, got ${intervalBlocks}` });
  }
  confirmationIntervals.set(key, intervalBlocks);
  const last = lastConfirmedHeights.get(key) ?? currentHeight;
  confirmationDue.set(key, nextHeight ?? last + intervalBlocks);
  return res.json({ node: key, intervalBlocks, nextHeight: confirmationDue.get(key) });
});

// Have a node's daemon hold `height` as its own, behind the chain's tip, or, with
// no height, follow the tip again. `:ip` is where the node really is.
control.post('/daemon-behind/:ip', (req, res) => {
  const key = String(req.params.ip).split(':')[0];
  const { height } = req.body || {};
  if (height === undefined || height === null) daemonsBehind.delete(key);
  else daemonsBehind.set(key, Number(height));
  res.json({ node: key, height: daemonsBehind.get(key) ?? null, tip: currentHeight });
});

control.post('/reset', (req, res) => {
  nodeStatusOverrides.clear();
  daemonsBehind.clear();
  reportedAddresses.clear();
  formerReportedAddresses.clear();
  pendingConfirmations.clear();
  confirmationIntervals.clear();
  confirmationDue.clear();
  hiddenFromPeers.clear();
  unresolvedNodes.clear();
  rpcFailures.clear();
  rpcMethodFailures.clear();
  // Answered, not dropped: a call left waiting on a hold outlives the reset and
  // hangs whatever made it.
  for (const ip of [...rpcHolds.keys()]) releaseHolds(ip);
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
