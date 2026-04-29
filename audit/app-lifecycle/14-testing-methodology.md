# Testing Methodology — How Tests Work

## Overview

The test network runs 16 real FluxOS nodes with compressed timing and stubbed
external services (daemon, syncthing, benchmark). Tests exercise real FluxOS
code paths — the spawner, P2P messaging, explorer, and monitoring loops all
run exactly as they do in production, just faster.

Each FluxOS container runs its own dockerd, matching production architecture
where both share the same host. This enables the full volume allocation flow
(fallocate → mkfs → loop mount) to work end-to-end.

---

## Authentication Flow

FluxOS uses BTC message signing for auth. The test runner implements this with
`@noble/secp256k1` (same library as flux-spec).

```
1. GET /id/loginphrase → returns a time-limited phrase
2. Sign the phrase: btcMagicHash(phrase) → secp256k1.signAsync()
3. POST /id/verifylogin (Content-Type: text/plain!) → { zelid, loginPhrase, signature }
4. Server stores session in loggedusers (14-day TTL)
5. Subsequent requests: header zelidauth = JSON.stringify({ zelid, loginPhrase, signature })
```

**IMPORTANT:** `verifyLogin` uses `req.on('data')` — if you send `Content-Type:
application/json`, Express's `json()` middleware eats the body. Always use `text/plain`.

### Privilege levels
- **user**: any valid session (node-01's keypair works for this)
- **admin**: session zelid matches `userconfig.initial.zelid` (node-01's keypair is admin on node-01)
- **appowner**: session zelid matches the app spec's `owner` field (app-owner keypair)

### Files
- `test-infra/runner/auth.js` — `authenticate(nodeUrl, keypair)` returns reusable zelidauth header
- `test-infra/fixtures/keys/node-01.json` — node admin keypair
- `test-infra/fixtures/keys/app-owner.json` — app owner keypair (used as spec owner)

---

## App Registration Flow

### Step 1: Build and sign the app spec

```javascript
const appSpec = {
  version: 8,
  name: 'e2eTestApp',
  owner: appOwner.zelid,      // must match the signing key
  compose: [{
    name: 'e2eTestApp',
    repotag: 'nginx:alpine',
    ports: [31111],
    containerPorts: [80],
    containerData: '/tmp',
    cpu: 0.1, ram: 100, hdd: 1,
    // ... other required fields
  }],
  instances: 3,
  expire: 22000,
  // ... other fields
};

const timestamp = Date.now();
const type = 'fluxappregister';
const version = 1;
const payload = type + version + JSON.stringify(appSpec) + timestamp;
const signature = await signBtcMessage(payload, appOwner.privkey);
```

The signature payload format is: `type + version + JSON.stringify(spec) + timestamp`
No separators, no hashing — raw concatenation, then BTC message signed.

### Step 2: Submit to FluxOS

```javascript
const body = { type, version, appSpecification: appSpec, timestamp, signature };

fetch(`${nodeUrl}/apps/appregister`, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain', zelidauth: auth.zelidauth },
  body: JSON.stringify(body),
});
// Returns: { status: 'success', data: '<64-char-hex-app-hash>' }
```

### Step 3: P2P propagation (automatic)

FluxOS broadcasts a `fluxappregister` temporary message to all peers. Each peer
stores it in `zelappstemporarymessages` (1-hour TTL). This happens automatically —
no test action needed. Takes ~15 seconds to reach all 16 nodes.

Verify: `GET /apps/temporarymessages/<appHash>` on each node.

### Step 4: Blockchain confirmation (daemon stub injection)

In production, the app owner pays FLUX on-chain. The explorer scans the blockchain
and finds the transaction. In our test network, we inject the transaction via the
daemon stub:

```javascript
fetch('http://198.18.0.3:18232/queue-app-tx', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ appHash }),
});
```

The daemon stub has a **block ticker** running every 5 seconds (configurable via
`BLOCK_INTERVAL_MS`). The queued app hash is included as a transaction in the
next ticked block. The block contains:

```javascript
{
  tx: [{
    txid: 'apptx-<hash-prefix>-<height>',
    version: 1,
    vin: [{ address: 'stub-sender-address' }],
    vout: [
      { valueSat: 10000000, scriptPubKey: { addresses: ['t3NryfAQLGeFs9jEoeqsxmBN2QLRaRKFLUX'] } },
      { valueSat: 0, scriptPubKey: { asm: 'OP_RETURN <hex-encoded-hash>' } },
    ],
  }],
}
```

The explorer processes this block (in `processInsight` mode), finds the OP_RETURN
hash, looks it up in `zelappstemporarymessages`, and promotes it to:
- `zelappsmessages` (permanent messages)
- `zelappsinformation` (active app registry)

### Step 5: Poll for confirmation

The test runner polls the explorer's scanned height until it passes the target
block, then checks if the app spec appeared in the permanent registry:

```javascript
GET /apps/appspecifications/<appName>
// Returns the spec from zelappsinformation if promoted
```

### Step 6: Spawner picks up the app (automatic)

Once the app is in `zelappsinformation`, the spawner detects it on its next cycle.
The spawner flow is:

1. Aggregate pipeline joins `zelappsinformation` with `zelappslocation` to find
   apps with fewer running instances than required
2. Filters by geolocation, enterprise ownership, error cache, already-running
3. Selects an app, defers it to `appsToBeCheckedLater` for ~2 min (non-enterprise
   on ArcaneOS)
4. After the defer period, re-checks instance count
5. Verifies Docker Hub image availability
6. Triple-checks instance count
7. Allocates storage volume (fallocate → mkfs → loop mount)
8. Pulls Docker image
9. Creates and starts the container
10. Broadcasts `fluxapprunning` to all peers

**Key timing in test network:**
- `FLUX_SPAWN_NO_APPS_DELAY_MS=15000` — check every 15s when no apps need instances
- Non-enterprise defer: ~2 min before re-check
- `shortDelayTime`: 5 min between spawner loops (from `getSpawnDelays` when ≤1 app)
- Total time from registration to container running: ~8-10 minutes

### Step 7: Verify running app

```bash
# Check locations from any node
curl -s http://198.18.1.0:16127/apps/location/e2eTestApp

# Hit the app directly on a hosting node
curl -s http://198.18.4.0:31111   # nginx welcome page

# Check Docker containers on a hosting node
docker compose exec -T fluxos-04 docker ps
```

---

## Block Injection — How It Works

### The daemon stub's block ticker

The daemon stub increments `currentHeight` every `BLOCK_INTERVAL_MS` (default 5s).
Each tick:
1. Increment `currentHeight`
2. If `pendingAppTxQueue` has entries, create a block with those transactions
3. Store the block in `pendingBlocks` array

When the explorer calls `getBlock(height, 2)`, the stub:
1. Checks `pendingBlocks` for a block at that height (comparing as number)
2. If found, returns the full block with transactions
3. If not found, returns an empty block

**Key detail:** The explorer passes height as a string (due to `ensureString()`
in `daemonServiceBlockchainRpcs.getBlock`). The stub converts to number for comparison.

### Explorer's processing loop

The explorer recursively calls `processBlock(height + 1)` when:
- `confirmations > 1` for the current block, OR
- `getBlockCount()` returns a height greater than current

When it reaches the tip (`confirmations === 1` and `getBlockCount() === height`),
it calls `initiateBlockProcessor(false, false)` which re-reads the scanned height
from DB and checks daemon height again. This creates a natural polling loop.

The block ticker ensures the daemon height keeps advancing, so the explorer
eventually catches up to any injected block.

### Pre-seeded data (mongo-init.js)

The `mongo-init.js` script runs once on first boot (empty volume only) and
pre-seeds two things for all 16 nodes:

1. **Explorer scanned height** — `node{NN}_zelcashdata.scannedheight` set to
   2100000. Without this, the explorer starts from `epochstart` (694000) and
   must process ~1.4M empty blocks to reach the daemon tip.

2. **Node geolocation** — `node{NN}_zelfluxlocal.geolocation` with EU/DE/Hesse
   coordinates. Without this, the spawner aborts with "Node Geolocation not set"
   because `ip-api.com` can't resolve RFC 2544 test IPs.

### Collateral verification

The spawner calls `nodeTier()` → `getrawtransaction(collateral_txid, 1)` to read
the collateral `vout` amount and determine the node's tier. The daemon stub matches
the txid against the deterministic node list and returns the correct collateral
amount based on tier (CUMULUS=1000, NIMBUS=12500, STRATUS=40000).

---

## What Each Stub Provides

### Daemon Stub (port 16124 fluxd, 16224 benchd, 18232 control)

**Per-node responses:** Maps source IP to deterministic list entry. Returns correct
IP, tier, pubkey, collateral, payment address for each calling node.

**Block production:** Ticker every 5s, queued app transactions included automatically.

**Collateral vout:** `getrawtransaction` with verbose=1 returns a proper `vout`
array with the correct collateral amount based on the node's tier from the
deterministic list.

**Key RPC methods handled:**
- `getblockchaininfo` — height, headers, sync status
- `getblockcount` — current height (increments with ticker)
- `getblock` — returns pending blocks with app txs, or empty blocks
- `getzelnodestatus` — per-node CONFIRMED status with correct collateral
- `getrawtransaction` — collateral tx with tier-appropriate vout
- `viewdeterministiczelnodelist` — loaded from `deterministic-list.json`
- `getbenchmarks` — per-node tier-appropriate hardware specs
- `getpublicip` / `getpublickey` — per-node values

### Syncthing Stub (port 8384 API, 8385 control)

Implements the full syncthing REST API surface. Maintains in-memory folders and
devices. Key endpoints:
- `/rest/noauth/health` → `{"status":"OK"}`
- `/rest/system/version` → v2.0.10
- `/rest/config/folders` — CRUD for sync folders
- `/rest/config/devices` — CRUD for devices
- `/rest/db/status` — folder sync status

**Port forwarding:** The FluxOS container runs `socat` to forward port 16129
(apiport+2) to the syncthing stub at 198.18.0.4:8384. This is needed because
the availability checker tests this port.

**Known issue:** `getDeviceId` returns malformed JSON. Non-blocking for spawner
flow but causes `SyntaxError` noise in logs.

### MongoDB (port 27017)

Mongo 8 with:
- `--wiredTigerCacheSizeGB 1` (shared host)
- `--setParameter maxNumActiveUserIndexBuilds=64` (16 nodes concurrent index creation)
- `ulimits: nofile: 65536` (EMFILE prevention)
- `mongo-init.js` pre-seeds scannedHeight + geolocation for all nodes

---

## Container Architecture — Why dockerd Inside FluxOS

### The Problem with Separate DinD Sidecars

The initial architecture used separate Docker-in-Docker sidecar containers:
```
fluxos-01 → DOCKER_HOST=http://198.18.1.1:2375 → dind-01 (privileged)
```

This broke at the volume allocation stage. FluxOS creates app volumes via:
1. `fallocate` a file on the filesystem
2. `mke2fs` to format it as ext4
3. `mount -o loop` to mount it as a block device
4. Pass the mount point as a Docker bind-mount to the app container

Steps 1-3 happen inside the FluxOS container's mount namespace. But step 4
tells the DinD daemon to bind-mount that path — and DinD runs in a different
container with a different mount namespace. It can't see the loop mount.

### The Fix: Merged Architecture

Run dockerd inside each FluxOS container, matching production:
```
fluxos-01 (privileged, runs dockerd + FluxOS in same namespace)
```

Both processes share the same filesystem and mount namespace. Loop mounts
created by FluxOS are visible to Docker. The full volume flow works.

### Implementation Details

**Dockerfile.fluxos** installs Docker Engine (docker-ce, containerd.io) from
Docker's official apt repository (using `noble` codename for compatibility
with Ubuntu 26.04).

**entrypoint.sh** handles startup:
1. Set up loopback IP, directories, syncthing config, socat
2. **cgroup v2 setup** — move processes to init sub-cgroup, enable subtree
   controllers (same as official docker:dind)
3. Start `dockerd &` in background
4. Poll `docker info` until ready (30s timeout)
5. `exec` FluxOS as PID 1

**cgroup v2 detail:** On cgroup v2 hosts, the container's root cgroup has both
processes and domain controllers enabled. cgroup v2 enforces "no internal
processes" — you can't have processes AND subtree controllers in the same cgroup.
The fix (from `moby/moby hack/dind`):
```bash
mkdir -p /sys/fs/cgroup/init
xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs
sed -e 's/ / +/g' -e 's/^/+/' < /sys/fs/cgroup/cgroup.controllers \
    > /sys/fs/cgroup/cgroup.subtree_control
```

**Volume mount:** Each container has a dedicated `appdata-NN` Docker volume at
`/mnt/appdata`. This appears in `df` as a proper `/dev/` mount. The production
volume filter (`advancedWorkflows.js`) correctly selects it for app data
allocation. `FLUX_APPS_FOLDER` is set to `/mnt/appdata/flux-apps`.

**Why /mnt/appdata instead of the overlay root?** Inside Docker, `df` shows
Docker's bind-mounted config files (`/etc/hosts`, `/etc/hostname`,
`/etc/resolv.conf`) as `/dev/` mounts. The production volume filter matches
them, but they're files, not directories. A dedicated volume mount at a clean
path avoids this entirely without production code changes.
