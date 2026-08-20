/*
 * CPU throttling, end to end.
 *
 * The throttler physically re-allocates container CPU: it counts how many of the
 * samples since its last decision sat at or above 92% of the app's allocation and,
 * if that is 80% of them, lowers the container's NanoCpus. Unit tests cover the
 * decision given a window of samples. They cannot cover the part that actually
 * breaks, because they hand it the window directly.
 *
 * The sampler and the throttler are separate functions on separate timers. If the
 * sampler stops filling the store — a wrong container-state string, a changed
 * field name, an exception swallowed in the interval — every unit test still
 * passes, no app is ever throttled again, and nothing says so. That is what this
 * suite exists to catch.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { execInContainer } from '../framework/container.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { startTicker, advanceBlock } from '../framework/daemon-control.js';
import {
  waitFor, waitForDaemonReady, waitForNodeStatus, waitForBlockProcessed,
  waitForAppInstalled, waitForAppSpecStored,
} from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// One spinner saturates one core, so BURN_SPINNERS must cover SPEC_CPU or the
// container never reaches the 92% of its allocation the throttler looks for.
const SPEC_CPU = 1.2;
const BURN_SPINNERS = 2;
// long enough for a decision (cpuCheckIntervalMs) over a full window
// (five samples at statsSampleIntervalMs), then the container goes idle in place
// so the restore path can be observed without stopping it
const BURN_FOR_S = 90;

function burningCompose(appName) {
  return [{
    name: appName,
    description: 'cpu burning test container',
    repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
    ports: [31131],
    domains: [''],
    // docker caps the container at its allocation, so the spin loop below costs
    // the host this app's share of a core and nothing more
    environmentParameters: [`BURN_CPU=${BURN_SPINNERS}`, `BURN_FOR_S=${BURN_FOR_S}`],
    commands: [],
    containerPorts: [80],
    containerData: '/tmp',
    cpu: SPEC_CPU,
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

async function nanoCpus(container, component) {
  const { stdout } = await execInContainer(
    container,
    `docker inspect --format '{{.HostConfig.NanoCpus}}' flux${component}`,
  );
  return Number(stdout.trim());
}

describe('CPU throttling', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const appName = `e2ecpu${Date.now()}`;
  const component = `${appName}_${appName}`;
  let node;

  before(async function () {
    this.timeout(360000);

    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    await pushTestApp(appName, 'v1');

    const spec = buildAppSpec({
      name: appName,
      compose: burningCompose(appName),
      // one is all this suite reads, and each instance burns SPEC_CPU of the
      // harness host for the length of the burn
      instances: 1,
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
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should start the container at the allocation the spec asked for', async function () {
    const applied = await nanoCpus(node.container, component);

    expect(applied, 'container started without a cpu limit').to.be.greaterThan(0);
    expect(applied).to.equal(SPEC_CPU * 1e9);
  });

  // The whole chain: the sampler collects, the store keeps what it collected, the
  // throttler reads it through its watermark and acts. Any link broken and the
  // allocation never moves.
  it('should lower the allocation for a container pinned at its limit', async function () {
    // the throttler needs more than four samples since its last decision, at
    // statsSampleIntervalMs each, and decides every cpuCheckIntervalMs
    this.timeout(180000);

    const before = await nanoCpus(node.container, component);

    await waitFor(
      async () => await nanoCpus(node.container, component) < before,
      { timeout: 150000, interval: 5000, label: 'cpu allocation lowered' },
    );

    const after = await nanoCpus(node.container, component);
    expect(after, 'allocation should drop, not rise').to.be.lessThan(before);
    // an app over 1 cpu and at its full allocation is lowered to 90% of spec
    expect(after).to.equal(Math.round(SPEC_CPU * 1e9 * 0.9));
  });

  // Without this the suite passes just as well against a throttler that only ever
  // ratchets down, which would strangle every app on the node over time.
  it('should restore the allocation once the load stops', async function () {
    this.timeout(180000);

    const lowered = await nanoCpus(node.container, component);
    expect(lowered).to.be.lessThan(SPEC_CPU * 1e9);

    // the container goes idle on its own after BURN_FOR_S, still running, so the
    // sampler keeps feeding the throttler a window that no longer looks busy
    await waitFor(
      async () => await nanoCpus(node.container, component) > lowered,
      { timeout: 180000, interval: 5000, label: 'cpu allocation restored' },
    );

    expect(await nanoCpus(node.container, component)).to.be.greaterThan(lowered);
  });
});
