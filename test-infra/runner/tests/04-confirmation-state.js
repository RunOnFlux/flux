import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { setNodeStatus, clearNodeStatus } from '../framework/daemon-control.js';
import { waitForDaemonReady, waitFor } from '../framework/wait.js';

describe('Confirmation state: confirmed boot', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: false });
    await waitForDaemonReady(env.clients[0]);
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
    expect(env.nodeHasLog(0, 'monitorNodeStatus - Node is Confirmed')).to.equal(true);
  });

  it('should start peer discovery', async function () {
    expect(env.nodeHasLog(0, 'Flux Discovery started')).to.equal(true);
  });
});

describe('Confirmation state: unconfirmed boot', function () {
  let env;

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({
      nodes: 1,
      tickerAutostart: false,
      nodeStatusOverrides: { '198.18.1.0': 'EXPIRED' },
    });
    await waitFor(() => env.nodeHasLog(0, 'discovery is awaiting'), {
      timeout: 60000, interval: 1000, label: 'unconfirmed boot log',
    });
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
    expect(env.nodeHasLog(0, 'discovery is awaiting')).to.equal(true);
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
    env = await createTestEnv({ nodes: 1, tickerAutostart: false });
    await waitForDaemonReady(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await clearNodeStatus('198.18.1.0');
    await env?.teardown();
  });

  it('should return EXPIRED from daemon after override set', async function () {
    await setNodeStatus('198.18.1.0', 'EXPIRED');
    await env.clients[0].waitForEvent('daemon:polled', (d) => d.height > 0, 15000);
    const res = await env.clients[0].getNodeStatus();
    expect(res.status).to.equal('success');
    expect(res.data.status).to.equal('EXPIRED');
  });

  it('should detect confirmation loss on next monitor cycle', async function () {
    this.timeout(30000);
    await setNodeStatus('198.18.1.0', 'EXPIRED');
    await waitFor(() => env.nodeHasLog(0, 'not.*[Cc]onfirmed|discovery is awaiting'), {
      timeout: 20000, interval: 1000, label: 'confirmation loss detected',
    });
    expect(env.nodeHasLog(0, 'not.*[Cc]onfirmed|discovery is awaiting')).to.equal(true);
  });
});
