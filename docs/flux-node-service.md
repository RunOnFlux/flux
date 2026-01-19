# Flux Node Service API Reference

Internal service that provides host information to Docker applications running on Flux Network nodes.

## Table of Contents

1. [Overview](#overview)
2. [Endpoint](#endpoint)
3. [Authentication](#authentication)
4. [Response Format](#response-format)
5. [Available Information](#available-information)
6. [Error Handling](#error-handling)
7. [Usage Examples](#usage-examples)

---

## Overview

The Flux Node Service is an internal HTTP server that runs on port **16101** and provides host information exclusively to Docker applications deployed on Flux Network. This service allows applications to discover information about the node they are running on, including:

- **Host Public IP** - The public IP address of the Flux node
- **Host Unique Identifier** - A unique identifier derived from the node's collateral transaction
- **Host Geolocation** - Geographic location data of the node
- **Host Benchmark Data** - Hardware specifications and performance metrics
- **Application Identity** - The name of the requesting application

**Module Location:** `ZelBack/src/services/fluxNodeService.js`

**Port:** 16101

**Bind Address:** Configured via `config.server.fluxNodeServiceAddress`

---

## Endpoint

### GET /hostinfo

Returns comprehensive information about the host node.

**URL:** `http://<bind-address>:16101/hostinfo`

**Method:** `GET`

**Headers:** None required

---

## Authentication

This service uses **IP-based authentication**. Only requests originating from Docker containers running Flux applications can access this endpoint.

The service:
1. Extracts the remote IP address from the incoming request
2. Looks up the Docker container associated with that IP
3. If no matching container is found, returns an unauthorized error

**Important:** This endpoint is not accessible from outside the Docker network. External requests will be rejected.

---

## Response Format

### Successful Response

```json
{
  "status": "success",
  "data": {
    "appName": "myapp_component",
    "id": "abc123def456...txindex",
    "ip": "123.45.67.89",
    "geo": {
      "continent": "Europe",
      "continentCode": "EU",
      "country": "Germany",
      "countryCode": "DE",
      "region": "BE",
      "regionName": "Berlin",
      "city": "Berlin",
      "lat": 52.52,
      "lon": 13.405,
      "static": true
    },
    "benchmark": {
      "vcores": 8,
      "ram": 7.1,
      "disk": 500,
      "diskwritespeed": 210.12640625,
      "eps": 489.2,
      "download_speed": 150.45212,
      "upload_speed": 50.216515
    }
  }
}
```

### Error Response

```json
{
  "status": "error",
  "data": {
    "code": null,
    "name": "Error",
    "message": "Error description"
  }
}
```

---

## Available Information

### Application Name (`appName`)

The name of the application/component making the request. This is automatically detected based on the container's IP address.

**Type:** `string`

**Example:** `"myapp_component"`, `"wordpress_web"`

---

### Node Identifier (`id`)

A unique identifier for the Flux node, derived from the node's collateral information. This is composed of the transaction hash concatenated with the transaction index.

**Type:** `string`

**Format:** `<txhash><txindex>`

**Example:** `"a1b2c3d4e5f6...9z0"` (64+ characters)

**Use Cases:**
- Uniquely identify the node across the network
- Track application instances across node migrations
- Implement node-specific configurations

---

### Host IP Address (`ip`)

The public IP address of the Flux node.

**Type:** `string`

**Format:** IPv4 address

**Example:** `"123.45.67.89"`

---

### Geolocation Data (`geo`)

Geographic location information for the node. The `ip` and `org` fields from the raw geolocation data are removed for privacy.

**Type:** `object`

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `continent` | string | Continent name | `"Europe"` |
| `continentCode` | string | Two-letter continent code | `"EU"` |
| `country` | string | Country name | `"Germany"` |
| `countryCode` | string | Two-letter country code (ISO 3166-1) | `"DE"` |
| `region` | string | Region/state code | `"BE"` |
| `regionName` | string | Region/state name | `"Berlin"` |
| `city` | string | City name | `"Berlin"` |
| `lat` | number | Latitude coordinate | `52.52` |
| `lon` | number | Longitude coordinate | `13.405` |
| `static` | boolean | Whether the IP is has static ip | `true` |

**Use Cases:**
- Geo-aware load balancing
- Regional content delivery
- Compliance with data residency requirements
- User proximity calculations

---

### Benchmark Data (`benchmark`)

Hardware specifications and performance metrics of the node. This data comes from the Flux benchmark daemon.

**Type:** `object`

| Field | Type | Unit | Description |
|-------|------|------|-------------|
| `vcores` | number | vcores | Number of CPU threads available |
| `ram` | number | MB | Total RAM in megabytes |
| `disk` | number | GB | Total disk space in gigabytes |
| `diskwritespeed` | number | MB/s | Disk write speed |
| `eps` | number | events/s | Events per second from the all vcores available (CPU benchmark) |
| `download_speed` | number | Mbps | Download speed in megabits per second |
| `upload_speed` | number | Mbps | Upload speed in megabits per second |

**Node Tiers:**

**Use Cases:**
- Workload optimization based on available resources
- Dynamic resource allocation
- Performance monitoring
- Capacity planning

---

## Error Handling

The service may return the following errors:

### Unauthorized Access

**Condition:** Request from non-Flux application container

```json
{
  "status": "error",
  "data": {
    "code": null,
    "name": "Unauthorized",
    "message": "Unauthorized. Access denied."
  }
}
```

### Host Identifier Unavailable

**Condition:** Node collateral information cannot be retrieved

```json
{
  "status": "error",
  "data": {
    "code": null,
    "name": "Error",
    "message": "Host Identifier information not available at the moment"
  }
}
```

### IP Unavailable

**Condition:** Node's public IP cannot be determined

```json
{
  "status": "error",
  "data": {
    "code": null,
    "name": "Error",
    "message": "Host IP information not available at the moment"
  }
}
```

### Geolocation Unavailable

**Condition:** Geolocation service fails to return data

```json
{
  "status": "error",
  "data": {
    "code": null,
    "name": "Error",
    "message": "Geolocation information not available at the moment"
  }
}
```

### Benchmark Unavailable

**Condition:** Benchmark data cannot be retrieved from daemon or database

```json
{
  "status": "error",
  "data": {
    "code": null,
    "name": "Error",
    "message": "Benchmark information is not available at the moment"
  }
}
```

---

## Usage Examples

### cURL (from within container)

```bash
curl http://172.17.0.1:16101/hostinfo
```

### Node.js

```javascript
const http = require('http');

async function getHostInfo() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '172.17.0.1',  // Docker host gateway
      port: 16101,
      path: '/hostinfo',
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status === 'success') {
            resolve(parsed.data);
          } else {
            reject(new Error(parsed.data.message));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Usage
getHostInfo()
  .then(info => {
    console.log('Node ID:', info.id);
    console.log('Location:', info.geo.city, info.geo.country);
    console.log('Resources:', info.benchmark.vcores, 'cores,', info.benchmark.ram, 'MB RAM');
  })
  .catch(err => console.error('Failed to get host info:', err.message));
```

### Python

```python
import requests
import json

def get_host_info():
    try:
        response = requests.get('http://172.17.0.1:16101/hostinfo', timeout=10)
        data = response.json()

        if data['status'] == 'success':
            return data['data']
        else:
            raise Exception(data['data']['message'])
    except requests.exceptions.RequestException as e:
        raise Exception(f'Failed to connect: {e}')

# Usage
try:
    info = get_host_info()
    print(f"Node ID: {info['id']}")
    print(f"Location: {info['geo']['city']}, {info['geo']['country']}")
    print(f"Resources: {info['benchmark']['vcores']} cores, {info['benchmark']['ram']} MB RAM")
except Exception as e:
    print(f"Error: {e}")
```

### Go

```go
package main

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"
)

type HostInfoResponse struct {
    Status string   `json:"status"`
    Data   HostInfo `json:"data"`
}

type HostInfo struct {
    AppName   string    `json:"appName"`
    ID        string    `json:"id"`
    IP        string    `json:"ip"`
    Geo       GeoInfo   `json:"geo"`
    Benchmark Benchmark `json:"benchmark"`
}

type GeoInfo struct {
    Continent     string  `json:"continent"`
    ContinentCode string  `json:"continentCode"`
    Country       string  `json:"country"`
    CountryCode   string  `json:"countryCode"`
    Region        string  `json:"region"`
    RegionName    string  `json:"regionName"`
    City          string  `json:"city"`
    Lat           float64 `json:"lat"`
    Lon           float64 `json:"lon"`
    Static        bool    `json:"static"`
}

type Benchmark struct {
    VCores         int `json:"vcores"`
    RAM            int `json:"ram"`
    Disk           int `json:"disk"`
    DiskWriteSpeed int `json:"diskwritespeed"`
    EPS            int `json:"eps"`
    DownloadSpeed  int `json:"download_speed"`
    UploadSpeed    int `json:"upload_speed"`
}

func getHostInfo() (*HostInfo, error) {
    resp, err := http.Get("http://172.17.0.1:16101/hostinfo")
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, err
    }

    var response HostInfoResponse
    if err := json.Unmarshal(body, &response); err != nil {
        return nil, err
    }

    if response.Status != "success" {
        return nil, fmt.Errorf("API error: %s", response.Status)
    }

    return &response.Data, nil
}

func main() {
    info, err := getHostInfo()
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }

    fmt.Printf("Node ID: %s\n", info.ID)
    fmt.Printf("Location: %s, %s\n", info.Geo.City, info.Geo.Country)
    fmt.Printf("Resources: %d cores, %d MB RAM\n", info.Benchmark.VCores, info.Benchmark.RAM)
}
```

---

## Best Practices

### Caching

The host information is relatively static. Consider caching responses to reduce load:

```javascript
let cachedHostInfo = null;
let cacheExpiry = 0;
const CACHE_TTL = 60000; // 1 minute

async function getHostInfoCached() {
  const now = Date.now();
  if (cachedHostInfo && now < cacheExpiry) {
    return cachedHostInfo;
  }

  cachedHostInfo = await getHostInfo();
  cacheExpiry = now + CACHE_TTL;
  return cachedHostInfo;
}
```

### Error Resilience

Implement retry logic for transient failures:

```javascript
async function getHostInfoWithRetry(maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await getHostInfo();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
}
```

### Startup Check

Verify connectivity to the service during application startup:

```javascript
async function verifyFluxEnvironment() {
  try {
    const info = await getHostInfo();
    console.log(`Running on Flux node ${info.id} in ${info.geo.city}`);
    return true;
  } catch (error) {
    console.warn('Not running on Flux or service unavailable:', error.message);
    return false;
  }
}
```

---

## Technical Details

### Service Lifecycle

The service is started and stopped via exported functions:

```javascript
// Start the service
fluxNodeService.start();

// Stop the service
fluxNodeService.stop();
```

### Data Sources

| Information | Source |
|-------------|--------|
| Application Name | `dockerService.getAppNameByContainerIp()` |
| Node ID | `generalService.obtainNodeCollateralInformation()` |
| IP Address | `fluxNetworkHelper.getMyFluxIPandPort()` |
| Geolocation | `geolocationService.getNodeGeolocation()` |
| Benchmark | `benchmarkService.getBenchmarks()` or database fallback |

### Benchmark Fallback

If the live benchmark call fails or returns an invalid tier status, the service falls back to retrieving the last known benchmark data from the database.

---

**Document Version:** 1.0
**Last Updated:** 2026-01-19
