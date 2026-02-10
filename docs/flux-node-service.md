# Flux Node Service API Reference

Service that provides host information to Docker applications running on Flux Network nodes.

## Table of Contents

1. [Overview](#overview)
2. [Endpoint](#endpoint)
3. [Authentication](#authentication)
4. [Response Format](#response-format)
5. [Available Information](#available-information)
6. [Error Handling](#error-handling)
7. [Usage Example](#usage-example)

---

## Overview

The Flux Node Service is an HTTP server that runs on port **16101** and provides host information exclusively to Docker applications deployed on Flux Network. This service allows applications to discover information about the node they are running on, including:

- **Host Public IP** - The public IP address of the Flux node
- **Host Unique Identifier** - A unique identifier derived from the node's collateral transaction
- **Host Geolocation** - Geographic location data of the node
- **Host Benchmark Data** - Hardware specifications and performance metrics
- **Application Identity** - The name of the requesting application

---

## Endpoint

### GET /hostinfo

Returns comprehensive information about the host node.

**URL:** `http://fluxnode.service:16101/hostinfo`

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
    "appName": "myapp",
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
      "static": true,
      "dataCenter": true
    },
    "benchmark": {
      "vcores": 8,
      "ram": 7.1,
      "disk": 220,
      "diskwritespeed": 540.25,
      "eps": 489.2,
      "eps_singlethread": 85.4,
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

The name of the application making the request. This is automatically detected based on the container's IP address.

**Type:** `string`

**Example:** `"myapp"`, `"wordpress"`

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
| `static` | boolean | Whether the IP has a static address | `true` |
| `dataCenter` | boolean | Whether the node is hosted in a data center | `true` |

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
| `ram` | number | GB | Total RAM in gigabytes |
| `disk` | number | GB | Total SSD/Nvme storage in gigabytes |
| `diskwritespeed` | number | MB/s | Disk write speed in megabytes per second |
| `eps` | number | events/s | Events per second from all vcores available (CPU benchmark) |
| `eps_singlethread` | number | events/s | Events per second from a single thread (CPU benchmark). Only available on nodes running benchmark version v6.1.0 |
| `download_speed` | number | Mbps | Download speed in megabits per second |
| `upload_speed` | number | Mbps | Upload speed in megabits per second |

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

## Usage Example

```bash
$ curl -s http://fluxnode.service:16101/hostinfo | jq .
{
  "status": "success",
  "data": {
    "appName": "myapp123",
    "id": "34gf818610f690d46c2a38473f008797a5ed203d4835a73b2881a264aecb56ab0",
    "ip": "1.2.3.4",
    "geo": {
      "continent": "Europe",
      "continentCode": "EU",
      "country": "United Kingdom",
      "countryCode": "GB",
      "region": "ENG",
      "regionName": "England",
      "lat": 51.5081,
      "lon": -0.1278,
      "static": true,
      "dataCenter": true
    },
    "benchmark": {
      "vcores": 16,
      "ram": 61,
      "disk": 880,
      "diskwritespeed": 1540.61,
      "eps": 4013.352,
      "eps_singlethread": 420.55,
      "download_speed": 600.0465950625,
      "upload_speed": 144.877045125
    }
  }
}
```
