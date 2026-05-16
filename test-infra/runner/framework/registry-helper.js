import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import axios from 'axios';

const __dirname = dirname(fileURLToPath(import.meta.url));
const caCert = readFileSync(join(__dirname, '..', '..', 'fixtures', 'registry-tls', 'ca.pem'));

const REGISTRY = 'https://198.18.0.5:5000';

const registryClient = axios.create({
  baseURL: REGISTRY,
  httpsAgent: new https.Agent({ ca: caCert }),
  maxBodyLength: Infinity,
  maxContentLength: Infinity,
});

function buildLayerTar(filename, content) {
  const data = Buffer.from(content);
  const header = Buffer.alloc(512);

  const nameBytes = Buffer.from(filename);
  nameBytes.copy(header, 0);

  header.write('0100644\0', 100, 'ascii');
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
  const padding = Buffer.alloc(padLen);
  const eof = Buffer.alloc(1024);
  return zlib.gzipSync(Buffer.concat([header, data, padding, eof]));
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

  const location = initRes.headers.location;
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
  const gzippedLayer = buildLayerTar('marker', markerContent);
  const layerDigest = await uploadBlob(repo, gzippedLayer);

  const uncompressedLayer = zlib.gunzipSync(gzippedLayer);
  const diffId = `sha256:${sha256(uncompressedLayer)}`;

  const configObj = {
    architecture: 'amd64',
    os: 'linux',
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

export async function pushUpdatedImage(repo, tag) {
  const marker = `updated-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  return pushImage(repo, tag, marker);
}
