import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import * as daemon from '../framework/daemon-control.js';
import { waitForApi } from '../framework/wait.js';
import { hasLogLine } from '../framework/log-reader.js';

describe('Confirmation state: confirmed boot', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: true });
    await waitForApi(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should detect status CONFIRMED from daemon', async function () {
    const res = await env.clients[0].getNodeStatus();
    expect(res.status).to.equal('success');
    expect(res.data.status).to.equal('CONFIRMED');
  });

  it('should log node is confirmed', async function () {
    const found = await hasLogLine(1, 'monitorNodeStatus - Node is Confirmed');
    expect(found).to.equal(true);
  });

  it('should start peer discovery', async function () {
    const found = await hasLogLine(1, 'Flux Discovery started');
    expect(found).to.equal(true);
  });
});

describe('Confirmation state: unconfirmed boot', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: true });
    await daemon.setNodeStatus('198.18.1.0', 'EXPIRED');
    // Restart the node so it boots into unconfirmed state
    const container = env.containers.fluxNodes[0].container;
    await container.restart();
    await waitForApi(env.clients[0]);
    await new Promise((r) => setTimeout(r, 10000));
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should detect EXPIRED status from daemon', async function () {
    const res = await env.clients[0].getNodeStatus();
    expect(res.status).to.equal('success');
    expect(res.data.status).to.equal('EXPIRED');
  });

  it('should log discovery awaiting', async function () {
    const found = await hasLogLine(1, 'discovery is awaiting');
    expect(found).to.equal(true);
  });

  it('should not connect any peers', async function () {
    const res = await env.clients[0].getPeers();
    expect(res.data).to.have.length(0);
  });
});

describe('Confirmation state: runtime loss', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: true });
    await waitForApi(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await daemon.clearNodeStatus('198.18.1.0');
    await env?.teardown();
  });

  it('should return EXPIRED from daemon after override set', async function () {
    await daemon.setNodeStatus('198.18.1.0', 'EXPIRED');
    const res = await env.clients[0].getNodeStatus();
    expect(res.status).to.equal('success');
    expect(res.data.status).to.equal('EXPIRED');
  });

  it('should detect confirmation loss on next monitor cycle', async function () {
    await daemon.setNodeStatus('198.18.1.0', 'EXPIRED');
    await new Promise((r) => setTimeout(r, 15000));
    const found = await hasLogLine(1, 'not.*[Cc]onfirmed|discovery is awaiting');
    expect(found).to.equal(true);
  });
});
