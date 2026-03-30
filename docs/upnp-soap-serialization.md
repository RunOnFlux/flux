# UPnP SOAP Call Serialization — Future Work

## Problem

All UPnP SOAP calls go through a single `natUpnp.Client` instance in `upnpService.js`. The library has no internal mutex or queue — concurrent calls produce concurrent HTTP POST requests to the router's SOAP endpoint. Cheap routers with single-threaded IGD implementations (e.g., some miniupnpd builds) may drop or error on concurrent requests.

The slot scheduling (see `upnp-smart-refresh.md`) prevents **inter-node** collisions, but **intra-node** concurrency is not serialized.

## Current State

### SOAP Client

```javascript
// upnpService.js:12
const client = new natUpnp.Client({ cacheGateway: true });
```

Single instance, shared by all callers. No serialization.

### Call Sites — Periodic / Looped

| Caller | File | Schedule | SOAP Calls |
|--------|------|----------|------------|
| `startPortsSupportLoop` | portManager.js | Wall-clock-aligned, every 10 min | `getPortMapping` per port, `setupUPNP` / `mapUpnpPort` on repair, `getLocalMappings` every 2h |
| `checkMyAppsAvailability` | availabilityChecker.js | Continuous (`setImmediate` recursion) | `mapUpnpPort` + `removeMapUpnpPort` per test cycle |
| `callOtherNodeToKeepUpnpPortsOpen` | portManager.js | Every 8 min | None (HTTP to peers only, no SOAP) |
| `adjustFirewallForUPNP` | serviceManager.js | Every 60 min | None (local `ufw` only, no SOAP) |

### Call Sites — One-Shot

| Caller | File | Trigger | SOAP Calls |
|--------|------|---------|------------|
| `verifyUPNPsupport` | upnpService.js | Node startup | `getPublicIp`, `getGateway`, `createMapping` x2, `getMapping` x2, `removeMapping` x2 |
| `appInstaller` | appInstaller.js | App install | `mapUpnpPort` (2 SOAP per port) |
| `appUninstaller` | appUninstaller.js | App uninstall | `removeMapUpnpPort` (2 SOAP per port) |
| `checkInstallingAppPortAvailable` | portManager.js | Pre-install check | `mapUpnpPort` + `removeMapUpnpPort` per test port |
| Admin API endpoints | upnpService.js | HTTP request | `mapPortApi`, `removeMapPortApi`, `getMapApi`, `getIpApi`, `getGatewayApi` |

### Concurrency Scenarios

The verify loop has `await serviceHelper.delay(interCallDelayMs)` between SOAP calls. During each `await`, the event loop is free to process SOAP calls from other callers:

1. **Verify loop + availability checker**: Both run continuously. Availability checker can call `mapUpnpPort` during the verify loop's inter-call delay. Different ports, so the router handles both independently — but two concurrent HTTP requests hit the SOAP endpoint.

2. **Verify loop + app install**: Same mechanism. App installer maps ports while verify checks other ports.

3. **Verify loop + admin API**: An operator hitting `/flux/mapport` while the verify loop is running.

## Proposed Solution: Async Queue

Add a simple promise-chain queue in `upnpService.js` that serializes all SOAP operations:

```javascript
let soapQueue = Promise.resolve();

function enqueueSoap(fn) {
  const pending = soapQueue.then(fn).catch((err) => { throw err; });
  soapQueue = pending.catch(() => {}); // prevent unhandled rejection on chain
  return pending;
}
```

Every function that calls `client.*` wraps the call:

```javascript
// Before:
const mapping = await client.getMapping({ public: port, protocol });

// After:
const mapping = await enqueueSoap(() => client.getMapping({ public: port, protocol }));
```

### Trade-offs

| Pro | Con |
|-----|-----|
| Router only sees one request at a time | All callers block on the queue — app install waits for verify loop's current call |
| Eliminates concurrent SOAP errors on cheap routers | Slightly increases total time for concurrent operations |
| Simple implementation (~10 lines) | Every SOAP call site needs wrapping |

### Implementation Scope

Functions that need `enqueueSoap` wrapping (all in `upnpService.js`):

| Function | `client.*` Calls |
|----------|-----------------|
| `verifyUPNPsupport` | `getPublicIp`, `getGateway`, `createMapping` x2, `getMapping` x2, `removeMapping` x2 |
| `setupUPNP` | `createMapping` x4 |
| `mapUpnpPort` | `createMapping` x2 |
| `removeMapUpnpPort` | `removeMapping` x2 |
| `getLocalMappings` | `getMappings` |
| `getPortMapping` | `getMapping` |
| `getStatusInfo` | `getStatusInfo` |
| `mapPortApi` | `createMapping` x2 |
| `removeMapPortApi` | `removeMapping` x2 |
| `getMapApi` | `getMappings` |
| `getIpApi` | `getPublicIp` |
| `getGatewayApi` | `getGateway` |

### Call Hierarchy

```
nat-upnp client (upnpService.js:12)
|
+-- verifyUPNPsupport           [startup]
|   +-- client.getPublicIp
|   +-- client.getGateway
|   +-- client.createMapping x2
|   +-- client.getMapping x2
|   +-- client.removeMapping x2
|
+-- setupUPNP                   [startup, repair]
|   +-- client.createMapping x4
|   +-- Called from: portManager.verifyAndRepairUpnpMappings
|
+-- mapUpnpPort                 [install, test, repair]
|   +-- client.createMapping x2 (TCP + UDP)
|   +-- Called from: appInstaller (lines 205, 243)
|   +-- Called from: portManager.verifyAndRepairUpnpMappings
|   +-- Called from: availabilityChecker.checkMyAppsAvailability
|   +-- Called from: portManager.checkInstallingAppPortAvailable
|
+-- removeMapUpnpPort           [uninstall, cleanup]
|   +-- client.removeMapping x2 (TCP + UDP)
|   +-- Called from: appUninstaller (lines 555, 566)
|   +-- Called from: portManager.cleanupOrphanedUpnpMappings
|   +-- Called from: availabilityChecker.handleTestShutdown
|   +-- Called from: portManager.checkInstallingAppPortAvailable
|
+-- getLocalMappings            [orphan cleanup]
|   +-- client.getMappings({ local: true })
|   +-- Called from: portManager.verifyAndRepairUpnpMappings (every 2h)
|
+-- getPortMapping              [verification]
|   +-- client.getMapping (single port, TCP)
|   +-- Called from: portManager.checkPortMapping
|
+-- getStatusInfo               [diagnostic]
|   +-- client.getStatusInfo
|   +-- (currently unused by any caller)
|
+-- Admin API handlers          [one-shot, operator-triggered]
    +-- mapPortApi              -> client.createMapping x2
    +-- removeMapPortApi        -> client.removeMapping x2
    +-- getMapApi               -> client.getMappings
    +-- getIpApi                -> client.getPublicIp
    +-- getGatewayApi           -> client.getGateway
```

### Timing Summary

| Process | Schedule | Can Overlap With |
|---------|----------|-----------------|
| Verify loop (`startPortsSupportLoop`) | Every 10 min, wall-clock-aligned 75s slot | All below |
| Availability checker (`checkMyAppsAvailability`) | Continuous, recursive `setImmediate` | All |
| App installer | One-shot during install | Verify loop, availability checker |
| App uninstaller | One-shot during uninstall | Verify loop, availability checker |
| Admin API | One-shot on HTTP request | All |
| Keep-alive (`callOtherNodeToKeepUpnpPortsOpen`) | Every 8 min | N/A (no SOAP calls) |
| Firewall adjust (`adjustFirewallForUPNP`) | Every 60 min | N/A (no SOAP calls) |
