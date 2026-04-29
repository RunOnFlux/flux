# App Spawner Audit — `trySpawningGlobalApplication()`

**File:** `ZelBack/src/services/appLifecycle/appSpawner.js`
**Audited:** 2026-04-29

## Architecture

The spawner is a single recursive function that never returns. Every exit point
delays then calls itself again. There is no `setInterval`, no event loop, no
queue processor — just a function that chains `await delay()` → `self()` at
every branch. There are approximately **40 distinct exit points**.

This makes the control flow extremely difficult to reason about:
- The function is ~700 lines long
- Each exit point has its own delay value, some configurable, most hardcoded
- The delay values are inconsistent (2 min here, 30 min there, 125 min elsewhere)
- Two different delay calculation calls (`getSpawnDelays`) produce different results
  at different points in the function
- The deferred queue system has bugs that negate its intended timing

---

## Timing Constants

### Configurable (env vars)

| Constant | Default | Env Var | Used For |
|---|---|---|---|
| `collisionWaitMs` | 90s | `FLUX_INSTALL_COLLISION_WAIT_MS` | Anti-collision propagation wait |
| `spawnReconfirmDelayMs` | 125 min | `FLUX_SPAWN_RECONFIRM_DELAY_MS` | Wait after node re-confirmation |
| `spawnNoAppsDelayMs` | 30 min | `FLUX_SPAWN_NO_APPS_DELAY_MS` | Wait when no apps need instances |

### Hardcoded

| Value | Where | Used For |
|---|---|---|
| 120s (`config.fluxapps.installation.delay`) | Pre-readiness gates | Retry when not synced / not confirmed |
| 60s | Post-install (hardcoded sleep) | Wait before surplus check |

### Calculated — `getSpawnDelays()` (`enterpriseNetwork.js`)

Returns `shortDelayTime` (skip-and-continue) and `delayTime` (longer pause):

| Scenario | `shortDelayTime` | `delayTime` |
|---|---|---|
| Enterprise (any count) | 30s | 60s |
| Non-enterprise, >1 app available | 60s | 60s |
| Non-enterprise, ≤1 app available | **5 min** | **30 min** |

**Problem:** `getSpawnDelays()` is called **twice**. The first call (line 64)
always passes `appsAvailable=0`, producing 5min/30min for non-enterprise. These
values persist for all deferred-queue paths (lines 196-209) that never reach the
second call (line 232). This means deferred apps always use the slow 5-min cadence
regardless of how many apps actually need instances.

---

## Complete Branch Map

### Phase 1: Pre-readiness gates

All use `config.fluxapps.installation.delay * 1000` = 2 min delay.

| # | Condition | Delay | Notes |
|---|---|---|---|
| 1 | Enterprise identity not resolved | 2 min | Outside try block — uncaught error crashes loop |
| 2 | Not synced | 2 min | |
| 3 | Hash sync never executed | 2 min | Blocked if `FLUX_MIN_HASH_SYNC_PEERS` too high |
| 4 | Node not confirmed | 2 min | Sets `fluxNodeWasNotConfirmedOnLastCheck = true` |
| 5 | **Reconfirmation after loss** | **125 min** | Uses `setTimeout` (not `await`), returns immediately |

Exit 5 deserves special attention: if a node briefly loses confirmation (e.g.,
daemon restart), the spawner goes completely silent for 125 minutes. The comment
says this is for "receiving all apps running on other nodes." The `setTimeout`
approach also means the function returns, so there is no guarantee against
concurrent invocations.

### Phase 1.5: First-execution tasks (not an exit)

On first synced+confirmed pass, runs `expireGlobalApplications()` and
`getPeerAppsInstallingErrorMessages()`. One-time, never repeats.

### Phase 2: Benchmark and IP checks

| # | Condition | Delay | Notes |
|---|---|---|---|
| 6 | Benchmark returns error | 2 min | |
| 7 | No IP address detected | throw → catch: `shortDelayTime` (5 min) | |

### Phase 3: Database query and app selection

| # | Condition | Delay | Notes |
|---|---|---|---|
| 8 | **No apps missing instances globally** | **30 min** (`spawnNoAppsDelayMs`) | Configurable |
| 9 | **Apps exist but all filtered out for this node** | **30 min** (`spawnNoAppsDelayMs`) | Same delay as "no apps at all" |

### Phase 3.1: Deferred queue processing

The spawner maintains two deferred queues:
- `appsToBeCheckedLater` — general deferrals (tier mismatch, target IP, etc.)
- `appsSyncthingToBeCheckedLater` — syncthing connectivity deferrals

**BUG 1 (Critical):** `findIndex((app) => app.timeToCheck >= Date.now())`

This finds apps whose scheduled check time is **in the future** — i.e., apps
that should still be waiting. The condition should be `<= Date.now()`. As written,
deferred apps are popped immediately on the next iteration (after just the
`shortDelayTime` inter-iteration delay), completely defeating the deferral system.

All deferral delays documented below are effectively collapsed to ~5 minutes.

**BUG 2 (Moderate):** `appsToBeCheckedLater.includes((appAux) => ...)`

`Array.includes()` does not take a callback function. It uses strict equality
comparison. This always returns `false`. The filter never removes apps already
in the deferred queue, causing duplicate entries. Should be `Array.some()`.

### Phase 4: Eligibility checks

| # | Condition | Delay | Notes |
|---|---|---|---|
| 10 | Already at required instances | `shortDelayTime` | |
| 11 | Enterprise-only on non-ArcaneOS | `shortDelayTime` | + 7-day error cache |
| 12 | Already running on this IP | `delayTime` | |
| 13 | Already installing on this IP | `delayTime` | |
| 14 | Missing app specifications | throw → catch | |
| 15 | Already locally installed | `shortDelayTime` | |
| 16 | User-blocked port | `shortDelayTime` | + 7-day error cache |
| 17 | Image compliance failure | throw → catch | + 7-day error cache (conditional) |
| 18 | Hardware requirements not met | throw → catch | |
| 19 | CPU burst headroom insufficient | throw → catch | Enterprise only |
| 20 | Ports already in use | throw → catch | |
| 21 | Ports not publicly available | `shortDelayTime` | |
| 22 | Triple-check instances exceeded | `shortDelayTime` | |

### Phase 5: Syncthing checks

| # | Condition | Delay | Notes |
|---|---|---|---|
| 23 | Same /16 IP range running | `shortDelayTime` | |
| 24 | Same /16 IP range installing | `shortDelayTime` | |
| 25 | Existing node unreachable | `shortDelayTime` | Deferred 27 min (but see Bug 1) |

### Phase 6: Target-IP deferral

| # | Condition | Delay | Notes |
|---|---|---|---|
| 26 | Has target IPs, not this node | `shortDelayTime` | Deferred: enterprise 30m, non-enterprise 57m |

### Phase 7: Tier-based deferral cascade

Skipped entirely for enterprise nodes. Skipped if app came from deferred queue.

| # | Condition | Non-Enterprise Deferral | Enterprise Deferral |
|---|---|---|---|
| 27 | Non-enterprise app on ArcaneOS | 2 min | N/A |
| 28 | Static IP node, non-static app | 27 min | N/A |
| 29 | Datacenter node, non-DC app | 27 min | N/A |
| 30 | Cumulus app on stratus (bamf) tier | **1h 57min** | 30 min |
| 31 | Nimbus app on stratus (bamf) tier | **1h 27min** | 21 min |
| 32 | Cumulus app on nimbus (super) tier | 57 min | 12 min |

Note: no deferral for right-sized apps (e.g., stratus app on stratus tier).

**All of these deferrals are effectively negated by Bug 1.** The deferred apps
are popped immediately (after ~5 min) instead of waiting their scheduled time.

### Phase 8: Docker image verification

| # | Condition | Delay | Notes |
|---|---|---|---|
| 33 | Repository verification fails | throw → catch | + 1-hour spawn cache |

### Phase 9: Final instance check

| # | Condition | Delay | Notes |
|---|---|---|---|
| 34 | Quadruple-check instances exceeded | `shortDelayTime` | |

### Phase 10: Anti-collision

1. Broadcast `fluxappinstalling` to all peers
2. Wait `collisionWaitMs` (90s, configurable)
3. Re-check running + installing counts
4. Sort installing list by `broadcastedAt` (earliest first)
5. If this node's position + running count > required, yield

| # | Condition | Delay | Notes |
|---|---|---|---|
| 35 | Too many installers (surplus) | `shortDelayTime` | First-come-first-served |
| 36 | Syncthing: same /16 IP running | `shortDelayTime` | |
| 37 | Syncthing: same /16 IP installing, not oldest | `shortDelayTime` | |

### Phase 11: Installation

| # | Condition | Delay | Notes |
|---|---|---|---|
| 38 | `registerAppLocally()` fails | `shortDelayTime` | |

After successful install: wait 60s (hardcoded), re-check if surplus, uninstall if so.

### Phase 12: Post-install

- Non-enterprise: wait `delayTime` (30 min if ≤1 app, 60s if >1)
- Enterprise: no delay, immediately recurses

### Phase 13: Catch block

- Adds `appHash` to `trySpawningGlobalAppCache` with 6-hour TTL
- Delay: `shortDelayTime || 5 min`

---

## Cache System

### `trySpawningGlobalAppCache` (appSpawnCache)

- Default TTL: **12 hours** (from cacheManager)
- Max entries: 250
- Set: Every app that gets past selection (line 272)
- Custom TTLs: Docker Hub failure → 1 hour, catch block → 6 hours
- Deleted: When app is deferred to a queue (so it can be re-selected later)
- Effect: Prevents re-attempting the same app hash within the TTL window

### `spawnErrorsLongerAppCache` (appSpawnErrorCache)

- Default TTL: **7 days**
- Max entries: 250
- Set: Enterprise-only on non-Arcane, user-blocked port, image compliance failure
- Never deleted by spawner
- Effect: Long-term suppression of fundamentally incompatible apps

---

## Timing Gap Analysis

### Worst case: Non-enterprise node, 1 app needs instances

1. Boot + sync + confirm: ~5 min (2-min retry loops)
2. If re-confirmation after loss: **+125 min**
3. Hash sync must complete (needs `FLUX_MIN_HASH_SYNC_PEERS` peers)
4. First spawner check finds no apps (app not registered yet): **+30 min**
5. App registered, spawner finds it
6. Tier deferral (e.g., cumulus on stratus): intended +1h57m, actual +5m (Bug 1)
7. `shortDelayTime` between iterations: **+5 min** (since ≤1 app)
8. Collision wait: +90s
9. Install + surplus check: +60s
10. Post-install delay: **+30 min** (`delayTime` for ≤1 app)
11. Next app: goes back to step 4

**Total from boot to first install (no re-confirmation):** ~45-50 minutes
**Total with re-confirmation:** ~170-175 minutes (nearly 3 hours)

### Best case: Enterprise node, many apps

1. Boot + sync + confirm: ~5 min
2. Spawner checks every 30s (`shortDelayTime` for enterprise)
3. No tier deferral (skipped for enterprise)
4. Collision wait: +90s
5. Post-install: no delay
6. Next app: immediate

**Total from boot to first install:** ~6-7 minutes

### The 5-minute cliff

The biggest timing inconsistency is in `getSpawnDelays()`:

```
appsAvailable > 1  → shortDelayTime = 60s
appsAvailable <= 1 → shortDelayTime = 5 min (5x slower!)
```

This means when there's only one app to install, the spawner is 5x slower at
every skip-and-retry step. Combined with the deferred-queue bug (Bug 1) which
collapses all deferrals to `shortDelayTime`, this 5-minute delay becomes the
dominant pacing factor for non-enterprise nodes with few apps.

---

## Bugs Summary

| Bug | Severity | Line | Description |
|---|---|---|---|
| 1 | **Critical** | 191-192 | `findIndex` uses `>=` instead of `<=`, popping deferred apps immediately |
| 2 | **Moderate** | 222 | `Array.includes()` with callback always returns `false`, should be `.some()` |
| 3 | **Minor** | 64 | First `getSpawnDelays()` call always passes `appsAvailable=0` |
| 4 | **Minor** | 107 | `setTimeout` for reconfirm delay means no concurrency guard |
| 5 | **Minor** | 26 | `appsCountAvailableToInstallOnMyNode` drifts across iterations |

---

## Architectural Concerns

1. **Recursion over iteration.** The entire function is a recursive loop with
   `async/await`. Each iteration adds a frame to the microtask queue. While
   V8 optimizes tail calls in some cases, `async` functions are NOT TCO'd —
   each awaited recursive call creates a new promise chain. Over hours/days
   of operation this is a slow memory leak (mitigated by the delays between
   calls, but architecturally wrong).

2. **No separation of concerns.** App selection, eligibility checking, Docker
   image verification, volume allocation, collision detection, and installation
   are all in one 700-line function. Each could be a separate step in a pipeline.

3. **Inconsistent delay strategy.** Some exits use `serviceHelper.delay()` (blocks
   the current execution), others use `setTimeout()` (returns immediately). This
   creates different concurrency semantics at different exit points.

4. **No backpressure or batching.** The function processes exactly one app per
   iteration. If 50 apps need instances, it takes 50 iterations (each with a
   5-minute delay for non-enterprise) = over 4 hours to even ATTEMPT all of them.

5. **Instance count checked 4 times.** The running+installing count is verified
   at lines 256, 388, 596, and 626 (post-collision). The first three are redundant
   if the data doesn't change between checks — and it shouldn't within a single
   synchronous code path. Only the post-collision check (after 90s wait) serves a
   purpose.

6. **Error handling is inconsistent.** Some failures add to the 7-day error cache,
   others to the 12-hour spawn cache, others to neither. The catch block adds to
   the 6-hour spawn cache only if not already in either cache. There's no clear
   policy for which errors are transient vs permanent.
