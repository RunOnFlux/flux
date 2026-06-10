import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { setNodeStatus, clearNodeStatus } from '../framework/daemon-control.js';
import { waitForDaemonReady, waitForNodeStatus, waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { getSubnetConfig } from '../framework/subnet-config.js';

const subnet = getSubnetConfig();

describe('Confirmation state: confirmed boot', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false, discoveryAutostart: true });
    await waitForDaemonReady(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should report confirmed on first monitor cycle', async function () {
    this.timeout(30000);
    const event = await waitForNodeStatus(env.clients[0], (d) => d.confirmed === true, 20000);
    expect(event.data.confirmed).to.equal(true);
  });

  it('should start peer discovery', async function () {
    expect(env.nodeHasLog(0, 'Flux Discovery started')).to.equal(true);
  });
});

describe('Confirmation state: unconfirmed boot', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this,
      nodes: 1,
      tickerAutostart: false,
      nodeStatusOverrides: { [subnet.nodeIp(1)]: 'EXPIRED' },
    });
    await waitForNodeStatus(env.clients[0], (d) => d.confirmed === false, 60000);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should report not confirmed on first monitor cycle', async function () {
    this.timeout(30000);
    const event = await waitForNodeStatus(env.clients[0], (d) => d.confirmed === false, 20000);
    expect(event.data.confirmed).to.equal(false);
  });

  it('should not start peer discovery', async function () {
    expect(env.nodeHasLog(0, 'Flux Discovery started')).to.equal(false);
  });

  it('should not connect any peers', async function () {
    const res = await env.clients[0].getPeers();
    expect(res.data).to.have.length(0);
  });
});

describe('Confirmation state: runtime loss', function () {
  let env;
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this, nodes: 1, tickerAutostart: false });
    await waitForDaemonReady(env.clients[0]);
    await waitForNodeStatus(env.clients[0], (d) => d.confirmed === true, 30000);
  });

  after(async function () {
    this.timeout(30000);
    await clearNodeStatus(subnet.nodeIp(1));
    await env?.teardown();
  });

  it('should detect confirmation loss after status override', async function () {
    this.timeout(30000);
    await setNodeStatus(subnet.nodeIp(1), 'EXPIRED');
    const event = await waitForNodeStatus(env.clients[0], (d) => d.confirmed === false, 20000);
    expect(event.data.confirmed).to.equal(false);
  });
});
