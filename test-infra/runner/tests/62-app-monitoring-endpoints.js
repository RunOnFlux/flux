/*
 * The monitoring endpoints, against a container that is genuinely running.
 *
 * Samples are stored as the dozen values the consumers read and put back into
 * the docker stats shape on the way out. Unit tests prove that round trip against
 * a fixture — which is to say, against my own assumptions about what docker
 * populates and how it spells it. Only a real reading proves the extract picks up
 * the fields that are actually there.
 *
 * This is also the first coverage these endpoints have had. Three of them shipped
 * dead on every node: the router called them with (req, res) and dropped the
 * trailing arguments the handlers dereferenced, and no test noticed because the
 * suite asserted that a response happened, which the catch block satisfies.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey, appOwnerKey } from '../framework/keys.js';
import { authenticate } from '../auth.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { pushImage } from '../framework/registry-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import {
  waitFor, waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppInstalled, waitForAppSpecStored,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

function localRegistryCompose(appName) {
  return [{
    name: appName,
    description: 'monitoring test container',
    repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
    ports: [31121],
    domains: [''],
    environmentParameters: [],
    commands: [],
    containerPorts: [80],
    containerData: '/tmp',
    cpu: 0.1,
    ram: 100,
    hdd: 1,
    repoauth: '',
  }];
}

async function bootAndPeer(env) {
  for (const client of env.clients) await waitForDaemonReady(client);
  await Promise.all(env.clients.map(
    (c) => waitForNodeStatus(c, (d) => d.confirmed === true, 30000),
  ));
  await advanceBlock();
  for (const client of env.clients) {
    await waitForBlockProcessed(client, (d) => d.height > env.initialHeight, 50000);
  }
  await env.startDiscovery();
  await env.clients[0].waitForEvent('peers:added', (d) => d.outbound >= 4, 120000);
  await env.clients[0].waitForEvent('peers:added', (d) => d.inbound >= 2, 120000);
  await startTicker();
}

describe('App monitoring endpoints', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2emon${Date.now()}`;
  const component = `${appName}_${appName}`;
  let node;
  let ownerAuth;

  before(async function () {
    this.timeout(300000);

    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await pushImage(appName, 'v1');

    const spec = buildAppSpec({
      name: appName,
      compose: localRegistryCompose(appName),
      instances: 3,
    });
    const regResult = await registerAndConfirm(
      env.clients[0].url, nodeKey(1), spec, env.clients,
    );
    expect(regResult.status).to.equal('success');

    await waitForBlockProcessed(
      env.clients[0], (d) => d.height >= regResult.targetHeight, 60000,
    );
    await waitForAppSpecStored(env.clients[0], appName);

    const installed = await Promise.any(
      env.clients.map((c, i) => waitForAppInstalled(c, appName, 180000).then(() => i)),
    );
    node = env.clients[installed];
    ownerAuth = await authenticate(node.url, appOwnerKey());

    // the sampler runs on statsSampleIntervalMs, two seconds in the harness
    await waitFor(async () => {
      const res = await node.getAuthed(`/apps/appmonitor/${component}`, ownerAuth.zelidauth);
      return res.status === 'success' && Array.isArray(res.data) && res.data.length >= 2;
    }, { timeout: 60000, interval: 2000, label: 'monitoring samples collected' });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should report samples a chart can plot', async function () {
    const res = await node.getAuthed(`/apps/appmonitor/${component}`, ownerAuth.zelidauth);

    expect(res.status).to.equal('success');
    expect(res.data).to.be.an('array').that.is.not.empty;

    const [sample] = res.data;
    expect(sample.timestamp, 'sample has no wall-clock time').to.be.a('number');
    expect(sample.timestamp).to.be.greaterThan(0);

    // Every field below is one the frontend reads. A real docker reading is the
    // only thing that proves the extract names them the way docker does.
    const { data } = sample;
    expect(data.cpu_stats.cpu_usage.total_usage, 'cpu total_usage').to.be.a('number');
    expect(data.precpu_stats.cpu_usage.total_usage, 'precpu total_usage').to.be.a('number');
    expect(data.cpu_stats.system_cpu_usage, 'system_cpu_usage').to.be.a('number');
    expect(data.precpu_stats.system_cpu_usage, 'precpu system_cpu_usage').to.be.a('number');
    expect(data.cpu_stats.online_cpus, 'online_cpus').to.be.a('number');
    expect(data.cpu_stats.online_cpus).to.be.greaterThan(0);

    // a running container always has a memory limit; zero means the extract
    // missed it rather than the container using nothing
    expect(data.memory_stats.limit, 'memory limit').to.be.a('number');
    expect(data.memory_stats.limit).to.be.greaterThan(0);
    expect(data.memory_stats.usage, 'memory usage').to.be.a('number');
    expect(data.memory_stats.usage).to.be.greaterThan(0);

    expect(data.nanoCpus, 'the allocation the chart scales against').to.be.a('number');
    expect(data.nanoCpus).to.be.greaterThan(0);
  });

  it('should report disk io as summed read and write entries', async function () {
    const res = await node.getAuthed(`/apps/appmonitor/${component}`, ownerAuth.zelidauth);
    const entries = res.data[0].data.blkio_stats.io_service_bytes_recursive;

    // absent is a legitimate reading for a container that has done no io; what
    // must not happen is the shape changing out from under the chart
    if (entries !== null) {
      expect(entries.map((e) => e.op)).to.deep.equal(['read', 'write']);
      entries.forEach((entry) => expect(entry.value).to.be.a('number'));
    }
  });

  it('should report the same shape from appstats', async function () {
    const res = await node.getAuthed(`/apps/appstats/${component}`, ownerAuth.zelidauth);

    expect(res.status).to.equal('success');
    expect(res.data.cpu_stats.cpu_usage.total_usage).to.be.a('number');
    expect(res.data.memory_stats.limit).to.be.greaterThan(0);
    expect(res.data.disk_stats, 'disk usage is attached by the node, not docker').to.be.an('object');
  });

  it('should thin a range past a day to hourly, keeping the newest sample', async function () {
    const dayMs = 24 * 60 * 60 * 1000;

    const full = await node.getAuthed(`/apps/appmonitor/${component}`, ownerAuth.zelidauth);
    const thinned = await node.getAuthed(
      `/apps/appmonitor/${component}/${dayMs + 1}`, ownerAuth.zelidauth,
    );

    expect(thinned.status).to.equal('success');
    // the whole series is minutes old, so hourly thinning leaves the first
    // sample and the newest — never an empty chart
    expect(thinned.data.length).to.be.at.least(1);
    expect(thinned.data.length).to.be.at.most(full.data.length);
    expect(
      thinned.data[thinned.data.length - 1].timestamp,
      'the newest sample must survive thinning or the chart stops short of now',
    ).to.equal(full.data[full.data.length - 1].timestamp);
  });

  it('should withhold monitoring data from an unauthenticated caller', async function () {
    const res = await node.get(`/apps/appmonitor/${component}`);

    expect(res.status).to.equal('error');
    expect(res.data.message).to.match(/unauthorized/i);
  });
});
