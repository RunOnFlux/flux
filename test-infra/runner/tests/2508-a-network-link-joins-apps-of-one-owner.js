/*
 * An app that names another in its description (networkWith:[...]) is joined to that app's
 * private network only when both have one owner: when the named app redeploys and its network's
 * members are reconnected, and when the node boots onto stopped app containers, as after a
 * reboot, and reconciles every link.
 *
 * Installing a linked app checks its owner, but a description-only update changes the link without
 * installing anything: the node rewrites its record and redeploys nothing. So the two linking apps
 * here gain their link that way, one owned by the network's owner and one by another, and are
 * alike in everything else. The same owner's app joining is the canary for each case.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import {
  execInContainer, crashFluxos, releaseFluxos, stopAppContainer,
} from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp, buildSeedableUpdate } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes, seedSpecUpdate } from '../framework/reconciler-suite.js';
import { appOwnerKey, otherOwnerKeys } from '../framework/keys.js';
import { appId } from '../framework/volume-fixture.js';
import { PRODUCTION } from '../framework/coupled-knobs.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import installOutcomeModule from '../../../ZelBack/src/services/utils/installOutcome.js';

const { InstallOutcome } = installOutcomeModule;
const HOLDER = 1;

describe('a network link joins apps of one owner', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const alice = appOwnerKey();
  const [bob] = otherOwnerKeys();
  const stamp = Date.now();
  const networkApp = `e2enetx${stamp}`; // Alice's, whose network the others name
  const sameOwner = `e2enetz${stamp}`; // Alice's
  const otherOwner = `e2enetw${stamp}`; // Bob's
  const network = `fluxDockerNetwork_${networkApp}`;
  const token = `networkWith:[${networkApp}]`;

  let holder;

  const build = (name, ownerKey) => buildSeedableApp({
    env,
    name,
    ownerKey,
    instances: 1,
    compose: [{
      name,
      description: 'network link test container',
      repotag: `${REGISTRY_REPO_HOST}/${name}:v1`,
      ports: [],
      domains: [''],
      environmentParameters: [],
      commands: [],
      containerPorts: [80],
      containerData: '/tmp',
      cpu: 0.1,
      ram: 100,
      hdd: 1,
      repoauth: '',
    }],
  });
  const members = async () => {
    const r = await execInContainer(holder.container, `docker network inspect ${network} -f '{{range .Containers}}{{.Name}} {{end}}'`);
    expect(r.exitCode, `inspecting ${network}: ${r.output}`).to.equal(0);
    return r.stdout.trim().split(/\s+/).filter(Boolean);
  };
  const isMember = async (name) => (await members()).includes(appId(name));
  // The holder's installed record, past the route's 30-second cache.
  const installedRecord = async (name) => {
    const res = await holder.get(`/apps/installedapps?_=${Date.now()}`);
    return (res.data ?? []).find((app) => app.name === name) ?? null;
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      // The boot test keeps FluxOS down while it stops the apps; the node's location records
      // outlive that at production's lifetime, as they outlive a reboot.
      configOverrides: {
        fluxapps: { sigtermExpiryS: PRODUCTION.sigtermExpiryS, locationTtlS: PRODUCTION.locationTtlS },
      },
    });
    await bootAndPeer(env);
    holder = env.clients[HOLDER];
    const everyNode = env.clients.map((_, i) => i);

    const apps = {};
    for (const [name, ownerKey] of [[networkApp, alice], [sameOwner, alice], [otherOwner, bob]]) {
      // eslint-disable-next-line no-await-in-loop
      await pushImage(name, 'v1');
      // eslint-disable-next-line no-await-in-loop
      apps[name] = await build(name, ownerKey);
      // eslint-disable-next-line no-await-in-loop
      await installOnNodes(env, apps[name], [HOLDER]);
    }

    // Each owner adds the link by changing its app's description, and nothing else.
    const linked = [[sameOwner, alice], [otherOwner, bob]];
    for (const [name, signer] of linked) {
      // eslint-disable-next-line no-await-in-loop
      const update = await buildSeedableUpdate(apps[name], (spec) => { spec.description = `${spec.description} ${token}`; }, { signer });
      // eslint-disable-next-line no-await-in-loop
      await seedSpecUpdate(env, update, everyNode);
    }
    await waitFor(async () => {
      const records = await Promise.all(linked.map(([name]) => installedRecord(name)));
      return records.every((record) => record?.description?.includes(token));
    }, { timeout: 300000, interval: 5000, label: 'the holder rewrites both records with the link' });
    // Rewritten without an install, so neither has been joined yet.
    expect(await isMember(sameOwner), `${sameOwner} on ${network} before any reconnect`).to.equal(false);
    expect(await isMember(otherOwner), `${otherOwner} on ${network} before any reconnect`).to.equal(false);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('joins the same owner\'s app, and not another owner\'s, when the named app redeploys', async function () {
    this.timeout(300000);
    const mark = holder.getLastEventId();
    await holder.redeployApp(networkApp, holder.zelidauth);
    const redeployed = await holder.waitForEvent('app:softRedeployed', (d) => d.name === networkApp, 240000, { afterId: mark });
    expect(redeployed.data.outcome, 'the redeploy').to.equal(InstallOutcome.INSTALLED);

    await waitFor(() => isMember(sameOwner), {
      timeout: 60000, interval: 2000, label: `${sameOwner} joins ${network}`,
    });
    expect(await isMember(otherOwner), `${otherOwner} on ${network}`).to.equal(false);
  });

  it('joins the same owner\'s app, and not another owner\'s, when the node boots with its apps stopped', async function () {
    this.timeout(420000);
    // Neither linking app on the network, whatever the redeploy left: only the boot can join them.
    for (const name of [sameOwner, otherOwner]) {
      // eslint-disable-next-line no-await-in-loop
      if (await isMember(name)) {
        // eslint-disable-next-line no-await-in-loop
        const left = await execInContainer(holder.container, `docker network disconnect ${network} ${appId(name)}`);
        expect(left.exitCode, `disconnecting ${name}: ${left.output}`).to.equal(0);
      }
      // eslint-disable-next-line no-await-in-loop
      expect(await isMember(name), `${name} before the boot`).to.equal(false);
    }

    // What a reboot leaves FluxOS to start on: every app container stopped.
    await crashFluxos(holder.container, { hold: true });
    for (const name of [networkApp, sameOwner, otherOwner]) {
      // eslint-disable-next-line no-await-in-loop
      const stopped = await stopAppContainer(holder.container, name);
      expect(stopped.exitCode, `stopping ${name}: ${stopped.output}`).to.equal(0);
    }
    await releaseFluxos(holder.container);

    await waitFor(() => isMember(sameOwner), {
      timeout: 180000, interval: 2000, label: `the boot rejoins ${sameOwner} to ${network}`,
    });
    expect(await isMember(otherOwner), `${otherOwner} on ${network}`).to.equal(false);
  });
});
