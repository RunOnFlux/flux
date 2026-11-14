/*
 * A node whose unit passes the node key as a credential reaches fluxd only through
 * what fluxd publishes: the cookie and the RPC port in /run/fluxd. It has no
 * flux.conf.
 *
 * Node 1 is that node; nodes 0 and 2 read flux.conf. The stub serves fluxd on its
 * default port, 16124, and on the port fluxd publishes, 16125, and accepts from
 * node 1 only its current cookie, so a call that arrives at all says which port
 * and which login the node used.
 *
 * The stub stands in for fluxd: the run files are written as fluxd writes them,
 * not by a fluxd.
 */
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { execInContainer, fluxosPid, restartFluxos } from '../framework/container.js';
import { failRpc, getJournal } from '../framework/daemon-control.js';
import {
  FLUXD_PUBLISHED_PORT, stopFluxd, startFluxd, restartFluxd,
  holdFluxdRefusals, heldFluxdRefusals, releaseFluxdRefusals,
} from '../framework/fluxd-control.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { afterTeardown } from '../framework/teardown-hook.js';

const CREDENTIAL = 1;
const FLUX_CONF = 0;
const FLUXD_DEFAULT_PORT = 16124;
// The stub's fluxbenchd, which journals its calls beside fluxd's.
const BENCHD_PORT = 16224;
// createTestEnv's FLUXD_PATH.
const FLUXD_PATH = '/dat/var/lib/fluxd';

describe('FluxOS reaches fluxd through what fluxd publishes when its unit passes the node key', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const node = () => env.clients[CREDENTIAL];
  const logins = async () => (await node().getTestCounters())?.['fluxd:login'] ?? 0;
  const portsUsed = async (client) => new Set((await getJournal({ sourceIp: client.ip })).entries
    .map((e) => e.port).filter((port) => port !== BENCHD_PORT));

  before(async function () {
    this.timeout(420000);
    env = await createTestEnv({ hookCtx: this, nodes: 3, credentialNodes: [CREDENTIAL] });
    await bootAndPeer(env);
  });

  afterTeardown(async function () {
    await env?.teardown();
  });

  it('a node with no flux.conf takes its key from the credential and calls fluxd on the published port with the cookie', async function () {
    this.timeout(60000);
    const noConf = await execInContainer(node().container, 'test ! -e /dat/var/lib/fluxd/flux.conf');
    expect(noConf.exitCode, 'the node has no flux.conf').to.equal(0);

    expect(await node().getTestState('fluxd')).to.include({ selfReporting: true });
    expect([...await portsUsed(node())]).to.eql([FLUXD_PUBLISHED_PORT]);

    // The canary: a node that reads flux.conf calls fluxd on its default port.
    const fluxConf = env.clients[FLUX_CONF];
    expect(await fluxConf.getTestState('fluxd')).to.include({ selfReporting: false });
    expect([...await portsUsed(fluxConf)]).to.eql([FLUXD_DEFAULT_PORT]);
  });

  it('while fluxd has published no port FluxOS waits and says why, and is ready once fluxd publishes one', async function () {
    this.timeout(240000);
    await stopFluxd(node());
    await restartFluxos(node().container);

    await waitFor(async () => {
      const { waitingFor } = await node().getTestState('fluxd');
      return typeof waitingFor === 'string' && waitingFor.includes('has not published its RPC port');
    }, { timeout: 60000, interval: 1000, label: 'FluxOS waiting for fluxd to publish its RPC port' });

    const mark = node().getLastEventId();
    await startFluxd(node());
    await node().waitForEvent('daemon:rpcAvailable', () => true, 60000, { afterId: mark });
    expect((await node().getTestState('fluxd')).waitingFor).to.equal(null);
  });

  it('FluxOS is ready only once fluxd has said which indexes it keeps', async function () {
    this.timeout(240000);
    const FAILURES = 3;
    await failRpc(node().ip, 'getindexinfo', { times: FAILURES });
    const restartedAt = Date.now();
    const mark = node().getLastEventId();
    await restartFluxos(node().container);
    await node().waitForEvent('daemon:rpcAvailable', () => true, 120000, { afterId: mark });

    // The canary: fluxd refused the question before it answered it.
    const asked = (await getJournal({ method: 'getindexinfo', sourceIp: node().ip })).entries
      .filter((e) => e.timestamp >= restartedAt);
    expect(asked.length, 'getindexinfo calls since the restart').to.be.above(FAILURES);
    expect((await node().getTestState('fluxd')).insightIndexes).to.equal(true);
  });

  it('the calls a fluxd restart refuses log in to it once, and FluxOS stays up', async function () {
    this.timeout(180000);
    const pid = await fluxosPid(node().container);
    const loginsBefore = await logins();

    await holdFluxdRefusals(node());
    await restartFluxd(node());
    await waitFor(async () => (await heldFluxdRefusals(node())) >= 2,
      { timeout: 60000, interval: 500, label: 'two calls refused by the restarted fluxd' });

    const mark = node().getLastEventId();
    const refused = await releaseFluxdRefusals(node());
    expect(refused, 'calls refused together').to.be.at.least(2);
    await node().waitForEvent('daemon:rpcAvailable', () => true, 60000, { afterId: mark });

    expect(await logins() - loginsBefore, 'logins').to.equal(1);
    expect(await fluxosPid(node().container), 'FluxOS pid').to.equal(pid);
  });

  it('the fluxd log endpoints read fluxd\'s directory from FLUXD_PATH', async function () {
    this.timeout(60000);
    const marker = `fluxd-log-marker-${Date.now()}`;
    const written = await execInContainer(node().container,
      `mkdir -p ${FLUXD_PATH} && echo ${marker} >> ${FLUXD_PATH}/debug.log`);
    expect(written.exitCode, written.output).to.equal(0);

    const { status, data } = await node().request('GET', '/flux/taildaemondebug', { headers: { zelidauth: node().zelidauth } });
    expect({ status, answer: data?.status }, JSON.stringify(data).slice(0, 300)).to.eql({ status: 200, answer: 'success' });
    expect(data.data.message).to.include(marker);

    const download = await node().request('GET', '/flux/daemondebug', { headers: { zelidauth: node().zelidauth } });
    expect(download.status, String(download.data).slice(0, 300)).to.equal(200);
    expect(download.data).to.be.a('string').and.include(marker);
  });
});
