/*
 * A syncthing identity copied from one node onto another is replaced on one of the
 * two, by whichever route reaches it first.
 *
 * Copied with the record of the node it was made for (flux-identity.json), it is
 * replaced on the copy at that node's first sentinel pass: the record names another
 * collateral. Copied without the record, the copy records it as its own, and it is
 * found only when the two nodes share an app: each reports the other's device ID as
 * its own, proves it in a TLS handshake with the other's syncthing, and the holder
 * whose collateral sorts higher replaces its identity.
 *
 * Both holders are legacy nodes running real syncthing, which FluxOS supervises; the
 * copy is made while the receiving node's FluxOS and syncthing are down, as a disk
 * image is copied. Each node replaces its identity at most once in six hours, so the
 * two cases are arranged to need a replacement on a different node each.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, crashFluxos, releaseFluxos } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableSyncthingApp, nodeOutpoint } from '../framework/seed-helper.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { waitFor, assertNoEvent } from '../framework/wait.js';
import {
  SYNCTHING_HOME, isDaemonUp, getDeviceId, stopDaemon,
} from '../framework/syncthing-real.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const HOLDERS = [1, 2];
const IDENTITY = ['cert.pem', 'key.pem'];
const RECORD = 'flux-identity.json';

describe('a syncthing identity copied onto another node is replaced on one of the two', function () {
  let env;
  dumpLogsOnFailure(() => env);
  // the holder whose collateral sorts higher, and the other
  const [low, high] = [...HOLDERS].sort((a, b) => (nodeOutpoint(a) < nodeOutpoint(b) ? -1 : 1));
  const client = (i) => env.clients[i];

  async function readHomeFile(i, file) {
    const r = await execInContainer(client(i).container, `base64 -w0 "${SYNCTHING_HOME}/${file}"`);
    expect(r.exitCode, `fixture: read ${file} on node ${i}: ${r.output}`).to.equal(0);
    return r.stdout.trim();
  }

  async function hasRecord(i) {
    const r = await execInContainer(client(i).container, `test -s "${SYNCTHING_HOME}/${RECORD}"`);
    return r.exitCode === 0;
  }

  // Copies `files` of one node's syncthing home onto another's, with that node's
  // FluxOS and syncthing down, then brings its FluxOS back.
  async function copyHome(from, to, files) {
    const contents = await Promise.all(files.map((file) => readHomeFile(from, file)));
    await crashFluxos(client(to).container, { hold: true });
    await stopDaemon(client(to));
    await Promise.all(files.map(async (file, k) => {
      const r = await execInContainer(client(to).container, `echo ${contents[k]} | base64 -d > "${SYNCTHING_HOME}/${file}"`);
      expect(r.exitCode, `fixture: write ${file} on node ${to}: ${r.output}`).to.equal(0);
    }));
    await releaseFluxos(client(to).container);
    await waitFor(async () => (await getDeviceId(client(to))) === (await getDeviceId(client(from))), {
      timeout: 180000, interval: 3000, label: `node ${to}'s syncthing runs node ${from}'s identity`,
    });
  }

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      legacyNodes: HOLDERS,
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: { fluxapps: { minOutgoing: 1, minIncoming: 1 } },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await Promise.all(HOLDERS.map((i) => waitFor(() => isDaemonUp(client(i)), {
      timeout: 180000, interval: 3000, label: `syncthing up on node ${i}`,
    })));
    const ids = await Promise.all(HOLDERS.map((i) => getDeviceId(client(i))));
    expect(new Set(ids).size, 'the holders start with identities of their own').to.equal(2);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('replaces an identity copied with its record on the node it was copied onto', async function () {
    this.timeout(900000);
    await waitFor(() => hasRecord(high), {
      timeout: 300000, interval: 3000, label: `node ${high} has recorded its syncthing identity`,
    });
    const original = await getDeviceId(client(high));
    const marks = HOLDERS.map((i) => client(i).getLastEventId());
    await copyHome(high, low, [...IDENTITY, RECORD]);

    const regenerated = await client(low).waitForEvent('syncthing:identityRegenerated', () => true, 600000, { afterId: marks[HOLDERS.indexOf(low)] });
    expect(regenerated.data.reason).to.include(nodeOutpoint(high));
    await waitFor(async () => {
      const id = await getDeviceId(client(low));
      return id && id !== original;
    }, { timeout: 180000, interval: 3000, label: `node ${low} runs a new identity` });
    expect(await getDeviceId(client(high)), 'the node it was copied from keeps its identity').to.equal(original);
    await assertNoEvent(client(high), 'syncthing:identityRegenerated', () => true, 1000, { afterId: marks[HOLDERS.indexOf(high)] });
  });

  it('replaces the identity of the higher holder once the two share an app, when copied without its record', async function () {
    this.timeout(1200000);
    const shared = await getDeviceId(client(high));
    const marks = HOLDERS.map((i) => client(i).getLastEventId());
    await copyHome(high, low, IDENTITY);

    const appName = `e2eclone${Date.now()}`;
    await pushImage(appName, 'v1');
    const app = await buildSeedableSyncthingApp({ name: appName, mode: 'g' });
    await installOnNodes(env, app, HOLDERS);

    await client(high).waitForEvent('syncthing:identityClash', (d) => d.deviceId === shared, 600000, { afterId: marks[HOLDERS.indexOf(high)] });
    await client(high).waitForEvent('syncthing:identityRegenerated', () => true, 300000, { afterId: marks[HOLDERS.indexOf(high)] });
    await waitFor(async () => {
      const id = await getDeviceId(client(high));
      return id && id !== shared;
    }, { timeout: 180000, interval: 3000, label: `node ${high} runs a new identity` });

    // the higher holder's replacement settles it: the lower keeps the identity
    await assertNoEvent(client(low), 'syncthing:identityRegenerated', () => true, 1000, { afterId: marks[HOLDERS.indexOf(low)] });
    expect(await getDeviceId(client(low)), 'the lower holder keeps the identity').to.equal(shared);
  });
});
