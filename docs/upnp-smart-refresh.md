# UPnP Smart Refresh

## Problem

FluxOS nodes behind consumer routers use UPnP to maintain port mappings. Previously, every 10 minutes each node blindly re-created all its UPnP mappings (TCP + UDP for every port). With 8 nodes behind one router, each with ~7 app ports plus 4 FluxOS ports, this produced **864 SOAP calls/hour** — all 8 nodes firing simultaneously.

## Solution

Per-port verification via `GetSpecificPortMappingEntry` (O(1) lookup) with wall-clock-aligned time slots so nodes behind the same router never collide.

## Architecture

```
startPortsSupportLoop()          ← self-scheduling, wall-clock-aligned
  └─ restorePortsSupport()       ← firewall rules + UPnP verify
       └─ verifyAndRepairUpnpMappings()
            ├─ checkPortMapping(port)          ← 1 SOAP call per port (TCP only)
            ├─ setupUPNP()                     ← re-map FluxOS ports if any missing
            ├─ mapUpnpPort()                   ← re-map individual app ports if missing
            └─ cleanupOrphanedUpnpMappings()   ← every 2 hours, piggybacks getLocalMappings
```

## Time Slot Scheduling

The 10-minute (600s) cycle is divided into 8 fixed 75-second slots. Each node's slot is deterministic based on its API port:

```
slot = Math.floor((apiPort % 100) / 10) % 8
```

| API Port | Slot | Window |
|----------|------|--------|
| 16187 | 0 | 0s - 75s |
| 16197 | 1 | 75s - 150s |
| 16127 | 2 | 150s - 225s |
| 16137 | 3 | 225s - 300s |
| 16147 | 4 | 300s - 375s |
| 16157 | 5 | 375s - 450s |
| 16167 | 6 | 450s - 525s |
| 16177 | 7 | 525s - 600s |

Slots are wall-clock-aligned (based on `epoch % 600`), not relative to process start. All nodes run chrony, so clocks are synced to sub-millisecond precision.

Within a slot, SOAP calls are spaced evenly:

```
interCallDelay = 75s / (totalPorts + 1)
```

| Total Ports | Spacing |
|-------------|---------|
| 4 (FluxOS only) | 15.0s |
| 11 (4 FluxOS + 7 apps) | 6.25s |
| 15 (4 FluxOS + 11 apps) | 4.7s |
| 24 (4 FluxOS + 20 apps) | 3.0s |

## Per-Cycle Flow

1. **Wait** until this node's wall-clock slot
2. **Firewall rules** — restore `ufw` rules for all ports (local, instant, no SOAP)
3. **Verify FluxOS ports** — `GetSpecificPortMappingEntry` for each of 4 ports (TCP only), spaced by `interCallDelay`
4. **If any FluxOS port missing** — `setupUPNP()` re-maps all 4 with correct descriptions
5. **Verify app ports** — same per-port check with spacing
6. **If app port missing** — `mapUpnpPort()` re-maps that port (TCP + UDP)
7. **If app port repair fails** — retry twice, then increment failure counter. At 3 consecutive failures, remove the app
8. **Every 2 hours** — `getLocalMappings()` to find and remove orphaned mappings

## SOAP Call Budget

### Per Cycle (steady state, nothing missing)

| Operation | SOAP Calls |
|-----------|------------|
| Check 4 FluxOS ports | 4 |
| Check N app ports | N |
| **Total** | **4 + N** |

### Per Cycle (with repairs)

| Scenario | SOAP Calls |
|----------|------------|
| 1 FluxOS port missing | 4 + N checks + 4 setupUPNP = **N + 8** |
| 1 app port missing | 4 + N checks + 2 mapUpnpPort = **N + 6** |
| All ports missing (reboot) | 4 + N checks + 4 setupUPNP + 2N mapUpnpPort = **3N + 8** |

### Per Hour (8 nodes, 7 app ports each, steady state)

| | Old | New |
|---|---|---|
| Calls per node per cycle | 18 | 11 |
| Calls per node per hour (6 cycles) | 108 | 66 |
| Calls from 8 nodes per hour | 864 | 528 |
| Simultaneous calls to router | Up to 144 (all 8 at once) | Max 1 (time-slotted) |

### Orphan Cleanup (every 2 hours)

`getLocalMappings()` enumerates all router mappings via `GetGenericPortMappingEntry` — approximately 26 SOAP calls for a typical router. This happens once every 2 hours (1 in 12 cycles), adding ~13 calls/hour amortized.

## Router Capability Probing

During `verifyUPNPsupport()` (startup), the router's TTL/lease behavior is probed:

| Capability | How Detected | Effect |
|-----------|-------------|--------|
| `supportsLeaseDuration` | Create mapping with `ttl=60`, read back | Test mappings use short TTL, skip explicit delete |
| `minLeaseDuration` | Read back actual TTL (may be capped, e.g. 900s on Sagemcom) | Used as TTL for test mappings |
| `igdV2Capping` | Create mapping with `ttl=0`, read back | If TTL > 0, router caps "permanent" leases |
| `maxLeaseDuration` | Read back TTL from `ttl=0` mapping | Stored for diagnostics |
| `routerInfo` | `getGateway()` description | Logged at startup |

## Test Mapping Optimization

Three call sites create short-lived test mappings:

| Location | Description |
|----------|------------|
| `verifyUPNPsupport()` | Startup verification |
| `checkInstallingAppPortAvailable()` | Pre-install port check |
| `checkMyAppsAvailability()` | Continuous availability monitoring |

When `supportsLeaseDuration` is true:
- Test mappings use `max(minLeaseDuration, 180)` seconds TTL instead of `ttl=0`
- Explicit `removeMapUpnpPort` is skipped — mapping auto-expires
- Saves 2 SOAP calls per test cycle

When `supportsLeaseDuration` is false (e.g. MikroTik):
- Unchanged: `ttl=0` + explicit delete

## Failure Handling

| Scenario | Behavior |
|----------|----------|
| `getSpecificPortMapping` returns mapping | Port OK, move on |
| `getSpecificPortMapping` returns null (error 714) | Mapping confirmed absent — re-map |
| `getSpecificPortMapping` throws (network error) | Router unreachable — skip port, don't count as failure |
| Re-map fails | Retry twice (5s delay each). If exhausted, increment failure counter |
| 3 consecutive cycle failures for an app | App removed from node |
| Failure counter for uninstalled app | Cleaned up at start of each cycle |

## Files

| File | Role |
|------|------|
| `ZelBack/src/services/upnpService.js` | UPnP client wrapper, capability probing, mapping constants |
| `ZelBack/src/services/appNetwork/portManager.js` | Slot scheduling, verify-and-repair loop, failure handling |
| `ZelBack/src/services/appMonitoring/availabilityChecker.js` | TTL-optimized test mappings |
| `ZelBack/src/services/serviceManager.js` | Starts the loop via `startPortsSupportLoop()` |

## Dependencies

- `@megachips/nat-upnp@^2.0.2` — UPnP library with `getMapping()` (GetSpecificPortMappingEntry), `getStatusInfo()`, SOAP fault detection, UpnpError with error codes
- Switch to `@runonflux/nat-upnp` before merge to main
