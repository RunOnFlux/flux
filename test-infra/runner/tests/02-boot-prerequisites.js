import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { waitForApi } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';

let env;

describe('Boot: prerequisites', function () {
  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ nodes: 1, tickerAutostart: true });
    await waitForApi(env.clients[0]);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('should connect to MongoDB', async function () {
    const db = dbClient(1);
    const height = await db.explorerHeight();
    expect(height).to.be.a('number');
    expect(height).to.be.greaterThan(0);
  });

  it('should prepare local database collections', async function () {
    expect(env.nodeHasLog(0, 'Local database prepared')).to.equal(true);
  });

  it('should prepare temporary database', async function () {
    expect(env.nodeHasLog(0, 'Temporary database prepared')).to.equal(true);
  });

  it('should prepare global app collections', async function () {
    expect(env.nodeHasLog(0, 'Flux Apps locations prepared')).to.equal(true);
  });

  it('should wait for daemon RPC before proceeding', async function () {
    expect(env.nodeHasLog(0, 'Daemon Sync status')).to.equal(true);
  });

  it('should report daemon as synced', async function () {
    const res = await env.clients[0].getBlockchainInfo();
    expect(res.status).to.equal('success');
    expect(res.data.blocks).to.be.greaterThan(0);
  });

  it('should detect node IP correctly', async function () {
    expect(env.nodeHasLog(0, 'Gathered IP 198.18.1.0')).to.equal(true);
  });

  it('should load geolocation from database', async function () {
    const db = dbClient(1);
    const geo = await db.geolocation();
    expect(geo).to.not.be.null;
    expect(geo.geolocation.ip).to.equal('198.18.1.0');
  });

  it('should start Docker daemon inside container', async function () {
    expect(env.nodeHasLog(0, 'dockerd is ready')).to.equal(true);
  });

  it('should initialize app spawner', async function () {
    expect(env.nodeHasLog(0, 'App Spawner initialized')).to.equal(true);
  });

  it('should start Flux Discovery', async function () {
    expect(env.nodeHasLog(0, 'Flux Discovery started')).to.equal(true);
  });

  it('should not log any config-related errors', async function () {
    const count = env.nodeLogCount(0, 'Cannot parse config|Cannot find module.*config');
    expect(count).to.equal(0);
  });

  it('[debug] should have captured log lines', async function () {
    const lines = env.nodeLogLines(0);
    console.log(`Total captured lines: ${lines.length}`);
    console.log('First 10 lines:', lines.slice(0, 10));
    console.log('Lines containing "prepared":', lines.filter(l => l.includes('prepared')));
    expect(lines.length).to.be.greaterThan(0);
  });
});
