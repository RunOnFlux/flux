# FluxOS E2E Test Infrastructure — Session Handoff

## Purpose

Build a deterministic E2E testing environment for the FluxOS application lifecycle
using a 16-node dockerized network. The goal is to test peer relationships, message
propagation, app registration, and full app lifecycle (install → monitor → update →
remove) in a controlled environment where the app spawner, monitoring loops, and P2P
messaging run in their "natural habitat" — not mocked, just with compressed timing.

This testing would validate the system before deploying to production's 10,000+ node
network. It is the foundation for proper integration testing of the decentralised
application platform.

---

## Repository Layout

```
/Users/davew/code/flux/flux/.claude/worktrees/app-lifecycle-audit/
├── audit/app-lifecycle/           # Analysis documents (NOT committed to git)
│   ├── 00-overview.md             # Document index
│   ├── 01-boot-sequence.md        # serviceManager boot order (40+ tasks)
│   ├── 02-recurring-tasks.md      # setInterval loops with timing diagram
│   ├── 03-api-endpoints.md        # 86+ API endpoints by lifecycle stage
│   ├── 04-app-lifecycle-flow.md   # Registration → install → monitor → update → remove
│   ├── 05-service-dependencies.md # Module inventory and dependency graph
│   ├── 06-testing-targets.md      # Concrete E2E test scenarios
│   ├── 07-p2p-messaging.md        # Message types, routing, relay, deduplication
│   ├── 08-explorer-block-processing.md  # Blockchain → app registry pipeline
│   ├── 09-error-paths.md          # Failure handling patterns
│   ├── 10-global-operations.md    # How /:global? propagates via HTTP
│   ├── 11-testing-architecture.md # Full infrastructure design
│   ├── 12-authentication.md       # Auth system and test strategy
│   ├── 13-upnp.md                 # UPnP integration and mock gateway design
│   ├── 14-testing-methodology.md  # How app registration/block injection works
│   └── README.md                  # THIS FILE — session handoff
│
├── test-infra/                    # Test infrastructure (committed to git)
│   ├── Dockerfile.fluxos          # Ubuntu 26.04 + Node 20 + Docker Engine
│   ├── entrypoint.sh              # cgroup v2 setup, dockerd, loopback IP, socat
│   ├── docker-compose.single.yml  # Single-node stack for debugging
│   ├── docker-compose.yml         # Full 16-node network (generated)
│   ├── generate-compose.js        # Generates docker-compose.yml from node-manifest.json
│   ├── daemon-stub/               # Fluxd + fluxbenchd JSON-RPC 2.0 stub
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── index.js               # Per-node responses, block ticker, app tx queue,
│   │                               # collateral vout for tier detection
│   ├── syncthing-stub/            # Syncthing REST API stub
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── index.js               # Full API surface + control API
│   ├── runner/                    # Test runner and helpers
│   │   ├── package.json           # @noble/secp256k1, @noble/hashes
│   │   ├── auth.js                # BTC message signing + FluxOS login flow
│   │   ├── test-auth.js           # Auth smoke test
│   │   └── test-register-app.js   # App registration + propagation + block injection
│   ├── upnp-stub/                 # (empty — not built yet)
│   └── fixtures/
│       ├── generate-keys.js       # Keypair + deterministic list + conf generator
│       ├── package.json           # @noble/secp256k1, @noble/hashes, bs58check
│       ├── mongo-init.js          # Pre-seeds scannedHeight + geolocation for all nodes
│       ├── flux.conf              # Base daemon config (not used directly — see conf/)
│       ├── userconfig-template.js # Node config with env var overrides
│       ├── syncthing-config.xml   # Syncthing config with stub API key
│       ├── deterministic-list.json # 16-node deterministic node list (bare IPs)
│       ├── node-manifest.json     # Node metadata (tier, region, staticIp, zelid)
│       ├── conf/                  # Per-node flux.conf with unique zelnodeprivkey
│       │   ├── flux-01.conf .. flux-16.conf  (all have insightexplorer=1)
│       └── keys/                  # 16 node keypairs + app-owner keypair
│           ├── node-01.json .. node-16.json  (privkey, pubkey, wif, zelid)
│           └── app-owner.json
```

## Branch & Worktree

- **Worktree path:** `/Users/davew/code/flux/flux/.claude/worktrees/app-lifecycle-audit/`
- **Branch:** `audit/app-lifecycle` (based off `development`)
- **Main repo:** `/Users/davew/code/flux/flux/`
- **Remote:** `me` → `git@github.com:MorningLightMountain713/flux.git`
- **Already cloned on cindy:** `~/flux-e2e` (checkout `audit/app-lifecycle`)

---

## Current State (verified on cindy, 2026-04-29)

### Working — Full App Lifecycle Through Deployment
- [x] 16 FluxOS nodes boot and stay running in Arcane mode
- [x] MongoDB 8 stable with 16 nodes (ulimit 65536, maxNumActiveUserIndexBuilds=64)
- [x] Peer discovery — nodes connect to each other (4 outgoing, 4 incoming)
- [x] Daemon sync passes (explorer scannedHeight matches daemon height)
- [x] P2P message signing works (per-node WIF keys in flux.conf)
- [x] Authentication — BTC message signing via @noble/secp256k1
- [x] App registration via API — `POST /apps/appregister` succeeds
- [x] **P2P message propagation — temp messages reach 16/16 nodes**
- [x] DosState clears to 0 (availability checker passes with socat port forward)
- [x] **Block injection → explorer promotion to permanent app spec (16/16 nodes)**
- [x] **Spawner detects app, selects it, passes all checks**
- [x] **Volume allocation — fallocate + mkfs + loop mount on /mnt/appdata**
- [x] **Docker image pull (nginx:alpine via local dockerd)**
- [x] **Container creation and startup (3/3 instances deployed)**
- [x] **App serving traffic — nginx responding on port 31111**
- [x] **Running status broadcast — all 16 nodes see 3 locations via API**
- [x] Container names prefixed `flux-e2e-*` (safe on live Arcane node)
- [x] 19 containers total (~1 GB memory footprint)

### Not Yet Tested
- [ ] App monitoring — `checkApplicationsCpuUsage`, `appstats`, `apptop`
- [ ] App updates — `POST /apps/appupdate` with modified spec
- [ ] App removal — owner-initiated removal, container cleanup
- [ ] Global removal propagation
- [ ] Node recovery — kill hosting node, verify `reconcileInstalledApps`
- [ ] Database consistency — verify all 16 nodes have identical app spec hashes
- [ ] Network partition / convergence after heal
- [ ] Force removal of expired apps

### Not Yet Built
- [ ] UPnP stub
- [ ] Test harness framework (currently ad-hoc scripts)
- [ ] Automated assertion-based tests (currently manual verification)

---

## Deployment Target

**Host:** `cindy` — a running ArcaneOS Flux node with Docker.

```bash
ssh -i ~/.ssh/nodes/fluxadm_1775071308 fluxadm@cindy
```

**CRITICAL:** ArcaneOS removes containers not prefixed with `flux`. The compose
files have `name: flux-e2e` baked in — no `-p` flag needed.

### Deploy/Update on cindy

```bash
ssh -i ~/.ssh/nodes/fluxadm_1775071308 fluxadm@cindy

cd ~/flux-e2e && git pull
cd test-infra

# Rebuild all images
docker compose -f docker-compose.yml build

# Full clean deploy (wipes volumes — fresh MongoDB + Docker data)
docker compose -f docker-compose.yml down --remove-orphans -v
docker compose -f docker-compose.yml up -d

# Rebuild just one image (e.g., daemon-stub only)
docker compose -f docker-compose.yml build daemon-stub
docker compose -f docker-compose.yml up -d daemon-stub
```

**Important:** When FluxOS source code changes, ALL 16 fluxos images need
rebuilding — they each have their own image (identical Dockerfile, but Docker
Compose treats them as separate build targets). Always run `docker compose build`
without specifying a service to rebuild all of them.

### Run test scripts on cindy

Tests run in a one-off container on the Docker network:

```bash
cd ~/flux-e2e/test-infra/runner
npm install --production  # first time only

# Auth test
docker run --rm --network flux-e2e_flux-test-net \
  -v $(pwd):/runner -v $(pwd)/../fixtures:/fixtures \
  -w /runner node:20-slim node test-auth.js

# App registration + blockchain confirmation + spawner test
docker run --rm --network flux-e2e_flux-test-net \
  -v $(pwd):/runner -v $(pwd)/../fixtures:/fixtures \
  -w /runner node:20-slim node test-register-app.js
```

### Useful diagnostic commands on cindy

```bash
# Check peers on a node
curl -s http://198.18.1.0:16127/flux/connectedpeers | python3 -m json.tool

# Check dosState
curl -s http://198.18.1.0:16127/flux/dosstate

# Check app locations (from any node)
curl -s http://198.18.1.0:16127/apps/location/e2eTestApp | python3 -m json.tool

# Check app spec
curl -s http://198.18.1.0:16127/apps/appspecifications/e2eTestApp | python3 -m json.tool

# Hit the running app directly
curl -s http://198.18.4.0:31111    # nginx on a hosting node

# Check Docker inside a FluxOS node
docker compose exec -T fluxos-04 docker ps

# Check df inside a container (verify volume mounts)
docker compose exec -T fluxos-01 df -a

# Daemon stub state
curl -s http://198.18.0.3:18232/state | python3 -m json.tool

# Queue an app tx for the next block
curl -X POST http://198.18.0.3:18232/queue-app-tx \
  -H 'Content-Type: application/json' \
  -d '{"appHash": "abc123..."}'

# MongoDB — check permanent app specs
docker compose exec mongodb mongosh --quiet --eval \
  "db.getSiblingDB('node01_globalzelapps').zelappsinformation.find({}, {name:1, _id:0}).toArray()"

# MongoDB — check app locations
docker compose exec mongodb mongosh --quiet --eval \
  "db.getSiblingDB('node01_globalzelapps').zelappslocation.find({}, {name:1, ip:1, _id:0}).toArray()"

# MongoDB — check install errors
docker compose exec mongodb mongosh --quiet --eval \
  "db.getSiblingDB('node01_globalzelapps').appsInstallingErrorsLocations.find({}, {_id:0}).toArray()"

# MongoDB — check explorer scanned height
docker compose exec mongodb mongosh --quiet --eval \
  "db.getSiblingDB('node01_zelcashdata').scannedheight.find().toArray()"

# MongoDB — check geolocation pre-seed
docker compose exec mongodb mongosh --quiet --eval \
  "db.getSiblingDB('node01_zelfluxlocal').geolocation.findOne({_id:'nodeGeolocation'}).geolocation.countryCode"

# FluxOS logs (filtered for spawner activity)
docker compose logs --since 5m fluxos-01 2>&1 | grep -i 'trySpawning\|install\|e2eTest'
```

### Push from local machine

```bash
cd /Users/davew/code/flux/flux/.claude/worktrees/app-lifecycle-audit
git push me audit/app-lifecycle
```

---

## Network Architecture

### IP Scheme: 198.18.0.0/16 (RFC 2544)

We use `198.18.0.0/15` (reserved for benchmarking/testing per RFC 2544) because
FluxOS's `isNonRoutableAddress()` rejects RFC1918 private ranges (10.x, 172.16-31.x,
192.168.x) with WebSocket close code 4002 (PRIVATE_IP). The `198.18.x.x` range is
NOT flagged by that check, so peers accept connections without any FluxOS code changes.

Docker handles outbound routing via NAT — containers can still reach the internet.

### Container Inventory (19 containers)

| Container | Count | IP | Purpose |
|-----------|-------|-----|---------|
| mongodb | 1 | 198.18.0.2 | Shared MongoDB 8 (per-node DB prefixes) |
| daemon-stub | 1 | 198.18.0.3 | Fluxd (16124) + fluxbenchd (16224) + control (18232) |
| syncthing-stub | 1 | 198.18.0.4 | Syncthing REST API (8384) + control (8385) |
| fluxos-NN | 16 | 198.18.N.0 | FluxOS + dockerd (privileged) |
| **Total** | **19** | | |

Each FluxOS container runs both FluxOS and its own dockerd. This matches production
where both processes share the same host. See "Architecture Decisions" below for why.

---

## FluxOS Code Changes (env-var gated, production defaults)

All changes fall back to production defaults when no env var is set.

### Config & Database (`ZelBack/config/default.js`)
| Env Var | Purpose | Default |
|---------|---------|---------|
| `FLUX_DB_PREFIX` | Prefix all 6 MongoDB database names | `""` |
| `FLUX_DB_HOST` | MongoDB host | `127.0.0.1` |
| `FLUX_DB_PORT` | MongoDB port | `27017` |
| `FLUX_SYNCTHING_HOST` | Syncthing API host | `127.0.0.1` |
| `FLUX_SYNCTHING_PORT` | Syncthing API port | `8384` |
| `FLUX_MIN_OUTGOING` | Min outgoing peers for app registration | `8` |
| `FLUX_MIN_INCOMING` | Min incoming peers for app registration | `4` |
| `FLUX_MIN_UNIQUE_OUTGOING` | Min unique outgoing IPs | `7` |
| `FLUX_MIN_UNIQUE_INCOMING` | Min unique incoming IPs | `3` |
| `FLUX_MIN_HASH_SYNC_PEERS` | Min peers for app hash sync | `12` |

### Docker (`ZelBack/src/services/dockerService.js`)
| Env Var | Purpose | Default |
|---------|---------|---------|
| `DOCKER_HOST` | Docker API URL (use `http://` not `tcp://`) | default socket |

**Note:** `DOCKER_HOST` is NOT set in the test network. FluxOS connects to the
local dockerd via `/var/run/docker.sock` (the default).

### Daemon/Benchmark RPC
| Env Var | File | Default |
|---------|------|---------|
| `FLUX_DAEMON_HOST` | daemonServiceUtils.js | `127.0.0.1` |
| `FLUX_BENCH_HOST` | benchmarkService.js | `127.0.0.1` |

### Timing (`ZelBack/src/services/serviceManager.js`)
| Env Var | Purpose | Default |
|---------|---------|---------|
| `FLUX_BOOT_DELAY_MULTIPLIER` | Scale ALL Phase 1 setTimeout delays | `1` |
| `FLUX_SPAWN_DELAY_MS` | Override spawner startup delay | `0` (original logic) |
| `FLUX_REMOVAL_SPACING_MS` | Delay between expired app removals | `60000` |
| `FLUX_PORT_RESTORE_INTERVAL_MS` | Port restore loop | `600000` |
| `FLUX_CPU_CHECK_INTERVAL_MS` | CPU check loop | `900000` |
| `FLUX_IMAGE_COMPLIANCE_INTERVAL_MS` | Image compliance loop | `3600000` |
| `FLUX_FORCE_REMOVAL_INTERVAL_MS` | Force removal loop | `7200000` |
| `FLUX_HASH_SYNC_INTERVAL_MS` | Hash sync loop | `1800000` |
| `FLUX_PEER_NOTIFY_INTERVAL_MS` | Peer notification loop | `3600000` |

### TTL Indexes (`ZelBack/src/services/serviceManager.js`)
| Env Var | Default |
|---------|---------|
| `FLUX_LOCATION_TTL_S` | `7500` |
| `FLUX_INSTALLING_TTL_S` | `900` |
| `FLUX_INSTALL_ERROR_TTL_S` | `3600` |
| `FLUX_TEMP_MSG_TTL_S` | `3600` |

### Spawner (`ZelBack/src/services/appLifecycle/appSpawner.js`)
| Env Var | Purpose | Default |
|---------|---------|---------|
| `FLUX_INSTALL_COLLISION_WAIT_MS` | Anti-collision wait before install | `90000` |
| `FLUX_SPAWN_RECONFIRM_DELAY_MS` | Wait after node re-confirmation | `7500000` |
| `FLUX_SPAWN_NO_APPS_DELAY_MS` | Wait when no apps need instances | `1800000` |

### Hash Sync (`appHashSyncService.js`, `messageVerifier.js`)
| Env Var | Purpose | Default |
|---------|---------|---------|
| `FLUX_MIN_HASH_SYNC_PEERS` | Min peers for hash sync to proceed | `12` |

### Other
| Env Var | File | Purpose | Default |
|---------|------|---------|---------|
| `FLUX_GLOBAL_CMD_DELAY_MS` | appController.js | Global command dispatch delay | `500` |
| `FLUX_UPNP_GATEWAY_URL` | upnpService.js | Skip SSDP, use known gateway | not set |
| `FLUX_NODE_IP` | upnpService.js | Node IP for UPnP mappings | `127.0.0.1` |
| `FLUX_LOG_CONSOLE` | log.js | Force console output in Arcane mode | not set |

---

## Debugging Guide

### No logs in `docker logs`?
Arcane mode (`FLUXOS_PATH` set) suppresses `console.log` in `log.js` line 75.
We set `FLUX_LOG_CONSOLE=1` to re-enable it. If still empty, read files from container:
```bash
docker cp flux-e2e-fluxos-01-1:/flux/error.log /tmp/error.log
cat /tmp/error.log
```

### Container exits immediately with code 1?
1. **dockerd not ready** — ECONNREFUSED triggers `uncaughtException` handler in
   apiServer.js. The entrypoint waits for dockerd readiness before starting FluxOS.
2. **Missing loopback IP** — 169.254.43.43 needed by fluxNodeService. Fix: entrypoint.sh
   adds it, container runs privileged.

### "Not enough outgoing peers"?
With 16 nodes and production thresholds (minOutgoing=8), one duplicate connection
drops below the limit. Test network uses `FLUX_MIN_OUTGOING=4`, `FLUX_MIN_INCOMING=2`.

### "Not enough connected peers to request missing Flux App messages"?
The hash sync requires 12 peers by default. Our 16-node network only achieves ~8
peers per node. Set `FLUX_MIN_HASH_SYNC_PEERS=4` in the test network. Without this,
`checkAndSyncAppHashesWasEverExecuted` never becomes true and the spawner never runs.

### MongoDB crashes (SIGSEGV/exit 139)?
16 nodes creating indexes concurrently. Fixed with:
- `ulimits: nofile: 65536` (EMFILE fix)
- `--setParameter maxNumActiveUserIndexBuilds=64` (index queue deadlock fix)
- `--wiredTigerCacheSizeGB 1` (prevent 50% RAM grab on shared host)

### Discovery takes ~5 minutes from cold boot?
The discovery loop retries every 120s on error. First iteration hits "daemon not
synced" (blockchain info service hasn't polled yet), waits 120s, then "node not
confirmed" if timing is unlucky, waits another 120s. **This is NOT covered by
FLUX_BOOT_DELAY_MULTIPLIER** — those retry delays are hardcoded in
`fluxCommunication.js` lines 966-971. Making them configurable is a TODO.

### Syncthing "not running properly" on loginPhrase?
The `loginPhrase` endpoint checks `syncthingService.isRunning()`. Syncthing reads
its API key from `config.xml`. The entrypoint copies `syncthing-config.xml` to
`/dat/usr/lib/syncthing/config.xml`. If this file is missing, syncthing reports
as not running and loginPhrase fails.

### verifyLogin hangs?
The `verifyLogin` endpoint uses `req.on('data')` to read the body (old-style).
If you send `Content-Type: application/json`, Express's `json()` middleware
consumes the body first, leaving nothing for the handler. **Send `Content-Type:
text/plain` instead.** The auth helper does this correctly.

### Spawner says "No installable application found" even though app is registered?
Three possible causes:
1. **Hash sync hasn't run yet** — `checkAndSyncAppHashesWasEverExecuted` is false.
   Check logs for "Not enough connected peers". Fix: lower `FLUX_MIN_HASH_SYNC_PEERS`.
2. **30-minute no-apps delay** — Spawner checked before app was registered, now sleeping.
   Fix: lower `FLUX_SPAWN_NO_APPS_DELAY_MS` (default 30 min, test network uses 15s).
3. **5-minute short delay** — After the "not enterprise, will check in ~2m" deferral,
   the spawner waits `shortDelayTime` (5 min for non-enterprise with ≤1 app) before
   re-entering the loop. This is from `getSpawnDelays()` in `enterpriseNetwork.js`.

### "Node Geolocation not set. Aborting."?
The spawner calls `nodeFullGeolocation()` which queries `ip-api.com`. Our RFC 2544
IPs can't be geolocated. Fix: `mongo-init.js` pre-seeds geolocation for all 16 nodes
into `node{NN}_zelfluxlocal.geolocation`. The spawner falls back to DB on cache miss.

### Syncthing JSON parse errors in logs?
The syncthing stub returns malformed JSON for the `getDeviceId` endpoint. Non-blocking
for the spawner flow but should be fixed. Low priority.

---

## Key Gotchas Discovered

### IP:port convention
Production fluxbenchd returns bare IP for port 16127 nodes (`178.79.183.164`)
and IP:port only for UPnP nodes on non-default ports (`178.79.183.164:16137`).
The `split(':')[1] || '16127'` pattern is everywhere in FluxOS. Our test nodes
use port 16127, so the deterministic list has bare IPs and the bench stub returns
bare IPs.

### Explorer insight mode
Must set `insightexplorer=1` in flux.conf. Without it, the explorer uses
`processStandard` which calls `getSender()` → `getRawTransaction()` for every
vin — requiring realistic UTXO data we don't have. Insight mode uses
`processInsight` which reads vin addresses directly from the block data.

**All 16 per-node conf files must have this.** A stale Docker image cache caused
nodes 02-16 to be built without the conf files, making them use `processStandard`
and crash on `getSender()`. Fix: `docker compose build --no-cache` or always
`docker compose build` (without `--no-cache` but without specifying a single service).

### Explorer scanned height pre-seed
With `insightexplorer=1`, the explorer starts from `epochstart` (694000). That's
~1.4M empty blocks to scan before reaching the daemon tip at 2100000. The
`mongo-init.js` script pre-seeds `scannedHeight = 2100000` for all 16 nodes via
`docker-entrypoint-initdb.d/` — runs once on first boot (empty volume only).

### Geolocation pre-seed
The spawner requires node geolocation before selecting apps to install. It normally
queries `ip-api.com`, which can't resolve our RFC 2544 test IPs. The `mongo-init.js`
script pre-seeds geolocation (EU/DE/Hesse) for all 16 nodes into
`node{NN}_zelfluxlocal.geolocation`. FluxOS reads it from DB on cache miss.

### Collateral verification
The spawner calls `nodeTier()` which does `getrawtransaction(collateral_txid)` and
reads `vout[txindex].value` to determine if the node is cumulus/nimbus/stratus. The
daemon stub must return a proper `vout` array with the correct collateral amount
(1000 for CUMULUS, 12500 for NIMBUS, 40000 for STRATUS). Without this, the spawner
crashes with `Cannot destructure property 'value' of undefined`.

### Block ticker vs manual advance
The daemon stub produces blocks every `BLOCK_INTERVAL_MS` (default 5000ms). This
keeps the explorer alive — it recursively calls itself when new blocks arrive.
App registration transactions are queued via `POST /queue-app-tx` and included
in the next ticked block. The test runner polls the explorer scanned height until
it passes the target block.

### Volume discovery in Docker
The production volume filter (`advancedWorkflows.js`) selects `/dev/` filesystem
mounts from `df` output. Inside Docker, `/etc/hosts`, `/etc/hostname`, and
`/etc/resolv.conf` appear as `/dev/` mounts (Docker bind-mounts them from the host
device). These are files, not directories, so `fallocate` on them fails.

**Fix:** Mount a dedicated Docker volume at `/mnt/appdata` for each node. This
shows up as a proper `/dev/` directory mount in `df`. Set `FLUX_APPS_FOLDER` to
`/mnt/appdata/flux-apps`. No production code changes needed — the existing filter
correctly selects it.

### cgroup v2 for Docker-in-container
dockerd inside a container fails to create child cgroups on cgroup v2 hosts because
the container's root cgroup has both processes and domain controllers (violates
cgroup v2's "no internal processes" rule). Fix: before starting dockerd, move all
processes to an init sub-cgroup and enable subtree controllers — same approach as
the official `docker:dind` image (`moby/moby hack/dind` script).

---

## Architecture Decisions

### Why 198.18.0.0/16?
FluxOS rejects WebSocket connections from RFC1918 private IPs (close code 4002).
198.18.0.0/15 is reserved for benchmarking/testing per RFC 2544 and not flagged
by `isNonRoutableAddress()`. No FluxOS code changes needed.

### Why shared MongoDB?
One mongod, per-node DB prefixes (`node01_zelfluxlocal`, etc.). Reduces 16
containers to 1. Test harness queries any node's DB directly for assertions.

### Why dockerd inside FluxOS containers (not separate DinD sidecars)?
In production, FluxOS and Docker run on the same host — they share the same
filesystem and mount namespace. The app volume allocation flow (`fallocate` →
`mkfs` → `mount -o loop`) creates a loop-mounted filesystem, then bind-mounts
it into the app's Docker container.

Initially we used separate DinD sidecar containers. This broke because FluxOS
creates the loop mount in its own container's mount namespace, but the DinD
daemon runs in a different container and can't see those mounts. Bind-mount
paths that FluxOS passes to Docker resolve to nothing inside DinD.

The fix: run dockerd inside each FluxOS container. Both processes share the same
mount namespace, so loop mounts are visible to Docker. The container runs
privileged (required for dockerd) and has a named Docker volume at
`/var/lib/docker` for persistent storage. This reduced the network from 35
containers (16 FluxOS + 16 DinD + 3 infra) to 19 containers (16 FluxOS + 3 infra).

### Why a dedicated /mnt/appdata volume?
Inside Docker, `df` shows `/dev/mapper/...` mounted at `/etc/hosts` (a Docker
bind-mount of the host's config file). The production volume filter matches it
because it's a `/dev/` filesystem. But `/etc/hosts` is a file, not a directory,
so `fallocate` on it fails.

Rather than modify production code, we mount a dedicated Docker volume at
`/mnt/appdata`. It shows up as a proper `/dev/` directory mount in `df`, and the
existing production filter correctly selects it. `FLUX_APPS_FOLDER` points there.

### Why Arcane mode?
Production runs ArcaneOS. Arcane skips legacy code paths (pm2 watchdog, apt
package checks, mongod GPG). Key env vars from production systemd:
`FLUXOS_PATH`, `SYNCTHING_PATH`, `FLUXD_PATH`, `FLUXBENCH_PATH`,
`FLUX_WATCHDOG_PATH`, `FLUX_APPS_FOLDER`.

### Why configurable timing?
The spawner waits 125 min after re-confirmation, monitoring loops run every 15-60
min, and no-apps delay is 30 min. Compressing via env vars exercises real code
paths in seconds. Key test-network overrides:
- `FLUX_SPAWN_NO_APPS_DELAY_MS=15000` (15s vs 30m)
- `FLUX_SPAWN_RECONFIRM_DELAY_MS=30000` (30s vs 125m)
- `FLUX_INSTALL_COLLISION_WAIT_MS=5000` (5s vs 90s)
- `FLUX_BOOT_DELAY_MULTIPLIER=0.1` (10% of normal)

### Why `Content-Type: text/plain` for POST endpoints?
Several FluxOS endpoints (verifyLogin, appregister) use `req.on('data')` to
read the request body. Express's `json()` middleware consumes the stream if
`Content-Type` is `application/json`, leaving nothing for the handler.

---

## Future Testing Plans

### Database Consistency
- Verify all 16 nodes have identical app spec hashes
- Cross-node `zelappsinformation` comparison
- Cross-node `zelappslocation` comparison
- Check `zelappshashes` consistency

### App Updates
- `POST /apps/appupdate` with modified spec
- Propagation of update message
- Blockchain confirmation of update
- Hosting nodes detect update and redeploy
- Expire-only update (no container restart)
- Image change (container restarted with new image)

### App Removal
- Owner-initiated removal via API
- Container cleanup on hosting nodes
- `fluxappremoved` broadcast
- `appsLocations` updated
- Global removal (propagates to all instances)

### Recovery
- Kill a hosting node → restart → `reconcileInstalledApps`
- Orphaned containers → `forceAppRemovals` cleanup
- Network partition → convergence after heal

### Infrastructure Gaps
- **UPnP stub** — SOAP service for port mapping tests during app install
- **Discovery retry configurable** — 120s retry delay in fluxCommunication.js
  is hardcoded and not affected by FLUX_BOOT_DELAY_MULTIPLIER
- **Test framework** — migrate from ad-hoc scripts to a proper test runner
  (mocha/jest) with assertions, timeouts, and parallel execution
- **32-node stress profile** — for multi-hop relay and convergence testing
- **Syncthing stub JSON fix** — `getDeviceId` returns malformed JSON
