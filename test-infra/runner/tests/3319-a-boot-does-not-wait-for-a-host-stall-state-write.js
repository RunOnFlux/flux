import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, crashFluxos, releaseFluxos } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A FluxOS that starts while the directory its host-stall state is kept in takes no
// writes: the state there cannot be read, so the start's first reading writes it,
// and that write does not end. The start returns once the reading has acted, and
// boot goes on to its next step.
//
// The node's /run/fluxos is a filesystem of its own, frozen, so a read of it answers
// and a write to it is held in the kernel.

const STATE_DIR = '/run/fluxos';
const STATE_FILE = `${STATE_DIR}/host-stall.json`;
const IMAGE = '/tmp/flux-e2e-run-fluxos.img';
// Boot's line after the host-stall service has started (serviceManager).
const NEXT_STEP = 'MongoDB connected';

describe('a boot does not wait for a host stall\'s state write', function () {
  let env;
  dumpLogsOnFailure(() => env);
  let client;
  let writesHeld;
  let bootLinesBefore;

  const sh = async (command) => {
    const r = await execInContainer(client.container, command);
    if (r.exitCode !== 0) throw new Error(`fixture: ${command}: ${r.output}`);
    return r.stdout;
  };

  before(async function () {
    this.timeout(300000);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false });
    [client] = env.clients;
    await waitFor(() => env.nodeLogCount(0, NEXT_STEP) >= 1, { timeout: 120000, interval: 1000, label: 'the node booted' });

    await crashFluxos(client.container, { hold: true });
    await sh(`rm -rf ${STATE_DIR} && mkdir -p ${STATE_DIR} && dd if=/dev/zero of=${IMAGE} bs=1M count=16 status=none`
      + ` && mke2fs -q -t ext4 ${IMAGE} && mount -o loop ${IMAGE} ${STATE_DIR}`
      + ` && printf '{ not json' > ${STATE_FILE} && sync -f ${STATE_FILE} && fsfreeze -f ${STATE_DIR}`);
    // a write held in the kernel cannot be killed: it runs in the background, and is
    // held while its marker has not appeared
    const marker = `/tmp/state-write-returned-${Date.now()}`;
    const probe = await execInContainer(client.container,
      `setsid sh -c 'echo x > ${STATE_DIR}/probe && touch ${marker}' </dev/null >/dev/null 2>&1 & sleep 3; test ! -e ${marker}`);
    writesHeld = probe.exitCode === 0;

    bootLinesBefore = env.nodeLogCount(0, NEXT_STEP);
    await releaseFluxos(client.container);
  });

  after(async function () {
    this.timeout(60000);
    if (client) await execInContainer(client.container, `fsfreeze -u ${STATE_DIR}; umount -l ${STATE_DIR}; rm -f ${IMAGE}`).catch(() => {});
    await env?.teardown();
  });

  it('holds every write to the state directory', function () {
    expect(writesHeld, 'a write to the state directory returned, so nothing below was tested').to.equal(true);
  });

  it('goes on to the next step of boot while the state write does not end', async function () {
    this.timeout(120000);
    await waitFor(() => env.nodeLogCount(0, NEXT_STEP) > bootLinesBefore, {
      timeout: 60000, interval: 1000, label: 'boot waited for the host stall\'s state write',
    });
  });
});
