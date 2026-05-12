import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { nodeClient } from '../framework/node-client.js';
import { dbClient } from '../framework/db-client.js';
import { waitForApi } from '../framework/wait.js';
import { hasLogLine, countPattern } from '../framework/log-reader.js';
import { isContainerRunning, listAppContainers } from '../framework/container.js';

const node = nodeClient(1);
const db = dbClient(1);

describe('Boot: prerequisites', function () {
  before(async function () {
    await waitForApi(node);
  });

  it('should have container running', async function () {
    const running = await isContainerRunning(1);
    expect(running).to.equal(true);
  });

  it('should connect to MongoDB', async function () {
    const height = await db.explorerHeight();
    expect(height).to.be.a('number');
    expect(height).to.be.greaterThan(0);
  });

  it('should prepare local database collections', async function () {
    const found = await hasLogLine(1, 'Local database prepared');
    expect(found).to.equal(true);
  });

  it('should prepare temporary database', async function () {
    const found = await hasLogLine(1, 'Temporary database prepared');
    expect(found).to.equal(true);
  });

  it('should prepare global app collections', async function () {
    const found = await hasLogLine(1, 'Flux Apps locations prepared');
    expect(found).to.equal(true);
  });

  it('should wait for daemon RPC before proceeding', async function () {
    const found = await hasLogLine(1, 'Daemon Sync status');
    expect(found).to.equal(true);
  });

  it('should report daemon as synced', async function () {
    const res = await node.getBlockchainInfo();
    expect(res.status).to.equal('success');
    expect(res.data.blocks).to.be.greaterThan(0);
  });

  it('should detect node IP correctly', async function () {
    const found = await hasLogLine(1, 'Gathered IP 198\\.18\\.1\\.0');
    expect(found).to.equal(true);
  });

  it('should load geolocation from database', async function () {
    const geo = await db.geolocation();
    expect(geo).to.not.be.null;
    expect(geo.geolocation.ip).to.equal('198.18.1.0');
  });

  it('should start Docker daemon inside container', async function () {
    const found = await hasLogLine(1, 'dockerd is ready');
    expect(found).to.equal(true);
  });

  it('should initialize app spawner', async function () {
    const found = await hasLogLine(1, 'App Spawner initialized');
    expect(found).to.equal(true);
  });

  it('should start Flux Discovery', async function () {
    const found = await hasLogLine(1, 'Flux Discovery started');
    expect(found).to.equal(true);
  });

  it('should not log any config-related errors', async function () {
    const configErrors = await countPattern(1, 'Cannot parse config|Cannot find module.*config');
    expect(configErrors).to.equal(0);
  });
});
