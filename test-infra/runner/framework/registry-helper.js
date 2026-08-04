import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import tls from 'node:tls';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import axios from 'axios';
import { getSubnetConfig, REGISTRY_ALIAS, REGISTRY_REPO_HOST } from './subnet-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const caCert = readFileSync(join(__dirname, '..', '..', 'fixtures', 'registry-tls', 'ca.pem'));

// The host pushes to the registry's IP (it can't resolve the Docker network alias),
// but the cert is bound to DNS:fluxregistry — so connect to the IP yet verify the
// cert against the alias name. Nodes pull via the alias directly. Base-independent.
const REGISTRY = `https://${getSubnetConfig().registry}:5000`;

const registryClient = axios.create({
  baseURL: REGISTRY,
  httpsAgent: new https.Agent({
    ca: caCert,
    checkServerIdentity: (host, cert) => tls.checkServerIdentity(REGISTRY_ALIAS, cert),
  }),
  maxBodyLength: Infinity,
  maxContentLength: Infinity,
});

// Minimal static x86_64 ELF binary that calls sys_pause in a loop (129 bytes).
// Assembled from: _start: mov eax,34; syscall; jmp _start
// No libc, no dynamic linker, no filesystem dependencies.
const PAUSE_BINARY = Buffer.from(
  '7f454c46020101000000000000000000'
  + '02003e00010000007800400000000000'
  + '40000000000000000000000000000000'
  + '00000000400038000100000000000000'
  + '01000000050000000000000000000000'
  + '00004000000000000000400000000000'
  + '81000000000000008100000000000000'
  + '0010000000000000b8220000000f05ebf7',
  'hex',
);

function tarEntry(name, data, mode = '0100755') {
  const header = Buffer.alloc(512);
  Buffer.from(name).copy(header, 0);
  header.write(`${mode}\0`, 100, 'ascii');
  header.write('0000000\0', 108, 'ascii');
  header.write('0000000\0', 116, 'ascii');
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  header.write('0000000\0', 136, 'ascii');
  header.write('        ', 148, 'ascii');
  header[156] = 48; // '0' = regular file
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const padLen = (512 - (data.length % 512)) % 512;
  return Buffer.concat([header, data, Buffer.alloc(padLen)]);
}

function buildLayerTar(markerContent) {
  const pauseEntry = tarEntry('bin/pause', PAUSE_BINARY);
  const markerEntry = tarEntry('marker', Buffer.from(markerContent), '0100644');
  const eof = Buffer.alloc(1024);
  return zlib.gzipSync(Buffer.concat([pauseEntry, markerEntry, eof]));
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function uploadBlob(repo, data) {
  const digest = `sha256:${sha256(data)}`;

  const initRes = await registryClient.post(`/v2/${repo}/blobs/uploads/`, null, {
    headers: { 'Content-Length': '0' },
    maxRedirects: 0,
    validateStatus: (s) => s === 202,
  });

  const { location } = initRes.headers;
  const separator = location.includes('?') ? '&' : '?';
  const putUrl = `${location}${separator}digest=${digest}`;

  await registryClient.put(putUrl, data, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': data.length,
    },
    validateStatus: (s) => s === 201,
  });

  return digest;
}

export async function pushImage(repo, tag, markerContent = 'v1') {
  const gzippedLayer = buildLayerTar(markerContent);
  const layerDigest = await uploadBlob(repo, gzippedLayer);

  const uncompressedLayer = zlib.gunzipSync(gzippedLayer);
  const diffId = `sha256:${sha256(uncompressedLayer)}`;

  const configObj = {
    architecture: 'amd64',
    os: 'linux',
    config: { Entrypoint: ['/bin/pause'] },
    rootfs: { type: 'layers', diff_ids: [diffId] },
  };
  const configBuf = Buffer.from(JSON.stringify(configObj));
  const configDigest = await uploadBlob(repo, configBuf);

  const manifest = {
    schemaVersion: 2,
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    config: {
      mediaType: 'application/vnd.docker.container.image.v1+json',
      size: configBuf.length,
      digest: configDigest,
    },
    layers: [{
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: gzippedLayer.length,
      digest: layerDigest,
    }],
  };

  const manifestRes = await registryClient.put(
    `/v2/${repo}/manifests/${tag}`,
    JSON.stringify(manifest),
    {
      headers: { 'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json' },
      validateStatus: (s) => s === 201,
    },
  );

  return manifestRes.headers['docker-content-digest'];
}

// Path to the compiled configurable test-app binary (see test-infra/test-app).
const TEST_APP_BIN = join(__dirname, '..', '..', 'test-app', 'test-app');

function buildBinaryLayerTar(binPath, binName, markerContent) {
  if (!existsSync(binPath)) {
    throw new Error(`test-app binary not found at ${binPath}. Build it once: bash test-infra/test-app/build.sh`);
  }
  const binEntry = tarEntry(`bin/${binName}`, readFileSync(binPath));
  const markerEntry = tarEntry('marker', Buffer.from(markerContent), '0100644');
  const eof = Buffer.alloc(1024);
  return zlib.gzipSync(Buffer.concat([binEntry, markerEntry, eof]));
}

// Push the configurable test-app image (entrypoint /bin/test-app). Exit behaviour
// is driven at run time by the app spec's environmentParameters (EXIT_CODE,
// EXIT_AFTER_S) — see buildSeedableTestApp and test-infra/test-app/test-app.c.
export async function pushTestApp(repo, tag = 'v1', markerContent = 'testapp') {
  const gzippedLayer = buildBinaryLayerTar(TEST_APP_BIN, 'test-app', markerContent);
  const layerDigest = await uploadBlob(repo, gzippedLayer);

  const uncompressedLayer = zlib.gunzipSync(gzippedLayer);
  const diffId = `sha256:${sha256(uncompressedLayer)}`;

  const configObj = {
    architecture: 'amd64',
    os: 'linux',
    config: { Entrypoint: ['/bin/test-app'] },
    rootfs: { type: 'layers', diff_ids: [diffId] },
  };
  const configBuf = Buffer.from(JSON.stringify(configObj));
  const configDigest = await uploadBlob(repo, configBuf);

  const manifest = {
    schemaVersion: 2,
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    config: {
      mediaType: 'application/vnd.docker.container.image.v1+json',
      size: configBuf.length,
      digest: configDigest,
    },
    layers: [{
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: gzippedLayer.length,
      digest: layerDigest,
    }],
  };

  const manifestRes = await registryClient.put(
    `/v2/${repo}/manifests/${tag}`,
    JSON.stringify(manifest),
    {
      headers: { 'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json' },
      validateStatus: (s) => s === 201,
    },
  );

  return manifestRes.headers['docker-content-digest'];
}

// ---------------------------------------------------------------------------
// Mirroring a real published image into the harness registry
// ---------------------------------------------------------------------------

// Every media type a manifest fetch may return. Sent on every request so the
// source registry answers with the index rather than resolving a platform for
// us - the whole point is to copy what is published, not one arch of it.
const MANIFEST_MEDIA_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

// Blobs and manifests are content-addressed and immutable, so a fetched one is
// good forever. The registry container is rebuilt per suite, so the PUSH happens
// every time (local, fast) but only the first suite of a gate pays for the pull.
const IMAGE_CACHE_DIR = join(__dirname, '..', '.image-cache');

const sourceClient = axios.create({
  maxBodyLength: Infinity,
  maxContentLength: Infinity,
  // Raw bytes, never parsed: a digest is over the exact bytes served, so
  // re-serialising a manifest through JSON would change what it hashes to.
  responseType: 'arraybuffer',
  transformResponse: [(data) => data],
});

function digestOf(buf) {
  return `sha256:${sha256(buf)}`;
}

function cachePathFor(digest) {
  const [algo, hex] = digest.split(':');
  return join(IMAGE_CACHE_DIR, algo, hex);
}

async function readCached(digest) {
  try {
    const bytes = await readFile(cachePathFor(digest));
    // A cache entry is trusted only as far as it hashes correctly. A truncated
    // file (an interrupted gate) would otherwise be served forever.
    return digestOf(bytes) === digest ? bytes : null;
  } catch {
    return null;
  }
}

async function writeCached(digest, bytes) {
  const path = cachePathFor(digest);
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

// A registry answers an unauthenticated request with the challenge describing
// where to get a token. Following it rather than hardcoding ghcr.io's endpoint
// means the same code mirrors from any compliant registry.
async function tokenFromChallenge(challenge) {
  const params = {};
  for (const part of challenge.replace(/^Bearer\s+/i, '').split(',')) {
    const [key, ...rest] = part.split('=');
    params[key.trim()] = rest.join('=').trim().replace(/^"|"$/g, '');
  }
  const url = new URL(params.realm);
  if (params.service) url.searchParams.set('service', params.service);
  if (params.scope) url.searchParams.set('scope', params.scope);
  const res = await axios.get(url.toString());
  return res.data.token ?? res.data.access_token;
}

async function fetchFromSource(url, accept) {
  const headers = accept ? { Accept: accept } : {};
  const attempt = () => sourceClient.get(url, {
    headers,
    validateStatus: (s) => s === 200 || s === 401,
  });

  let res = await attempt();
  if (res.status === 401) {
    const token = await tokenFromChallenge(res.headers['www-authenticate'] ?? '');
    res = await sourceClient.get(url, {
      headers: { ...headers, Authorization: `Bearer ${token}` },
      validateStatus: (s) => s === 200,
    });
  }
  return { bytes: Buffer.from(res.data), contentType: res.headers['content-type'] };
}

async function fetchByDigest(registry, repo, kind, digest) {
  const cached = await readCached(digest);
  if (cached) return cached;

  const url = `https://${registry}/v2/${repo}/${kind}/${digest}`;
  const { bytes } = await fetchFromSource(url, kind === 'manifests' ? MANIFEST_MEDIA_TYPES : null);

  const actual = digestOf(bytes);
  if (actual !== digest) {
    throw new Error(`${url} served ${actual}, not the requested ${digest}`);
  }
  await writeCached(digest, bytes);
  return bytes;
}

async function blobExists(repo, digest) {
  const res = await registryClient.head(`/v2/${repo}/blobs/${digest}`, {
    validateStatus: (s) => s === 200 || s === 404,
  });
  return res.status === 200;
}

async function putManifest(repo, reference, bytes, mediaType) {
  const res = await registryClient.put(`/v2/${repo}/manifests/${reference}`, bytes, {
    headers: { 'Content-Type': mediaType },
    validateStatus: (s) => s === 201,
  });
  return res.headers['docker-content-digest'];
}

// Depth-first: an index is pushed only once every manifest it names is present,
// because registry:2 validates that each reference resolves at PUT time.
async function mirrorManifest(source, repo, digest) {
  const bytes = await fetchByDigest(source.registry, source.repo, 'manifests', digest);
  const manifest = JSON.parse(bytes.toString());

  for (const entry of manifest.manifests ?? []) {
    // eslint-disable-next-line no-await-in-loop
    await mirrorManifest(source, repo, entry.digest);
  }

  const referenced = [manifest.config, ...(manifest.layers ?? [])].filter(Boolean);
  for (const blob of referenced) {
    // eslint-disable-next-line no-await-in-loop
    if (await blobExists(repo, blob.digest)) continue;
    // eslint-disable-next-line no-await-in-loop
    const blobBytes = await fetchByDigest(source.registry, source.repo, 'blobs', blob.digest);
    // eslint-disable-next-line no-await-in-loop
    const pushed = await uploadBlob(repo, blobBytes);
    if (pushed !== blob.digest) {
      throw new Error(`blob ${blob.digest} pushed as ${pushed}`);
    }
  }

  const pushed = await putManifest(repo, digest, bytes, manifest.mediaType);
  if (pushed !== digest) {
    throw new Error(`manifest ${digest} pushed as ${pushed}`);
  }
  return manifest;
}

/**
 * Copy a published, digest-pinned image into the harness registry byte for byte.
 *
 * The harness runs a registry per suite on a fresh volume, so every node starts
 * with an empty image store. Left pointing at the public registry, a ten-node
 * env would pull the same image ten times per suite across a whole gate, from a
 * rate-limited anonymous endpoint - so a gate would go red whenever that
 * endpoint had a bad day. Everything else external here is stubbed for the same
 * reason.
 *
 * This is a copy of raw bytes, NOT `docker save` / `docker load`. A manifest
 * digest is taken over the manifest bytes, so preserving them is what keeps the
 * digest production pins resolving here; save/load rebuilds the manifest and
 * the pin stops matching. The registry host becomes the only difference between
 * what the fleet runs and what a node under test runs.
 *
 * Multi-arch indexes are copied whole, attestation manifests included. Those
 * carry `unknown/unknown` platforms and an in-toto payload, and registry:2
 * accepts them - which matters because an index digest covers every entry, so
 * dropping one would change it.
 *
 * @param {string} reference A digest-pinned reference, `host/repo@sha256:...`.
 * @param {string} [repo] Destination repository. Defaults to the source's.
 * @returns {Promise<string>} The same image addressed in the harness registry.
 */
export async function mirrorImage(reference, repo = null) {
  const match = /^([^/]+)\/(.+)@(sha256:[0-9a-f]{64})$/.exec(reference);
  if (!match) {
    throw new Error(`mirrorImage needs a digest-pinned host/repo@sha256:... reference, got '${reference}'`);
  }
  const [, registry, sourceRepo, digest] = match;
  const destRepo = repo ?? sourceRepo;

  await mirrorManifest({ registry, repo: sourceRepo }, destRepo, digest);

  return `${REGISTRY_REPO_HOST}/${destRepo}@${digest}`;
}

export async function pushUpdatedImage(repo, tag) {
  const marker = `updated-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  return pushImage(repo, tag, marker);
}

export async function pushBrokenImage(repo, tag) {
  const gzippedLayer = buildLayerTar('broken');
  const layerDigest = await uploadBlob(repo, gzippedLayer);

  const uncompressedLayer = zlib.gunzipSync(gzippedLayer);
  const diffId = `sha256:${sha256(uncompressedLayer)}`;

  const configObj = {
    architecture: 'amd64',
    os: 'linux',
    config: { Entrypoint: ['/nonexistent'] },
    rootfs: { type: 'layers', diff_ids: [diffId] },
  };
  const configBuf = Buffer.from(JSON.stringify(configObj));
  const configDigest = await uploadBlob(repo, configBuf);

  const manifest = {
    schemaVersion: 2,
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    config: {
      mediaType: 'application/vnd.docker.container.image.v1+json',
      size: configBuf.length,
      digest: configDigest,
    },
    layers: [{
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: gzippedLayer.length,
      digest: layerDigest,
    }],
  };

  const manifestRes = await registryClient.put(
    `/v2/${repo}/manifests/${tag}`,
    JSON.stringify(manifest),
    {
      headers: { 'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json' },
      validateStatus: (s) => s === 201,
    },
  );

  return manifestRes.headers['docker-content-digest'];
}
