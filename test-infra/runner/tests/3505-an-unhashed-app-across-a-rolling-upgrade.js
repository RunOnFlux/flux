// base-image: FLUX_E2E_BASE_TAG
// weight: medium
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { dbClient } from '../framework/db-client.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A network part way through an upgrade. Node 0 runs the FluxOS the others
// upgrade from (FLUX_E2E_BASE_TAG), which refuses a whole apprunning message for
// one entry without a hash; nodes 1 and 2 run this build.
//
// An upgraded node holding an app installed without a hash leaves it out of its
// announcements (app:running.unannounced), so the node not yet upgraded goes on
// storing the rest (network:apprunning). A node not yet upgraded announces such
// an app, and the upgraded nodes write its other entries and refuse that one,
// both of which their network:apprunning says.
//
// Without FLUX_E2E_BASE_TAG the suite fails before booting, naming what it needs.

const BASE_TAG = process.env.FLUX_E2E_BASE_TAG;
const NOT_UPGRADED = 0;
const UPGRADED = [1, 2];
const bare = (address) => String(address).replace(/:16127$/, '');

function appComponent(appName) {
  return {
    name: 'alpha',
    description: 'rolling upgrade',
    repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
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
  };
}

describe('an app installed without a hash, across a rolling upgrade', function () {
  let env;
  dumpLogsOnFailure(() => env);
  const stamp = Date.now();

  // Install `appName` on `holder`, then give it an app installed without a hash.
  async function holderWithUnhashedApp(appName, holder) {
    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({ name: appName, instances: 1, compose: [appComponent(appName)] });
    await installOnNodes(env, app, [holder]);
    const { hash, ...withoutHash } = await dbClient(holder + 1).localApp(appName);
    expect(hash, 'fixture: the app is installed with a hash').to.be.a('string');
    const unhashed = `${appName}unhashed`;
    const afterIds = env.clients.map((c) => c.getLastEventId());
    await dbClient(holder + 1).seedLocalApp({ ...withoutHash, name: unhashed });
    return { unhashed, afterIds };
  }
  const storedFrom = (i, afterId, holder, appName) => env.clients[i].waitForEvent(
    'network:apprunning',
    (d) => bare(d.ip) === bare(socketAddr(holder + 1)) && d.apps?.some((a) => a.name === appName),
    120000,
    { afterId },
  );

  before(async function () {
    this.timeout(420000);
    if (!BASE_TAG) {
      throw new Error('FLUX_E2E_BASE_TAG names the node image of the FluxOS the nodes upgrade from: build it from that tree with FLUX_E2E_TAG=<tag> ./test-infra/build-images.sh fluxos-01');
    }
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      nodeImageTags: { [NOT_UPGRADED]: BASE_TAG },
    });
    if (BASE_TAG === env.nodeImageTag(UPGRADED[0])) throw new Error('FLUX_E2E_BASE_TAG must name another build than FLUX_E2E_TAG');
    await bootAndPeer(env);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('an upgraded node leaves the app out, and the node not yet upgraded goes on storing the rest', async function () {
    this.timeout(420000);
    const appName = `e2erollupgraded${stamp}`;
    const holder = UPGRADED[0];
    const { unhashed, afterIds } = await holderWithUnhashedApp(appName, holder);

    const { data: announced } = await env.clients[holder].waitForEvent(
      'app:running', (d) => d.apps?.some((a) => a.name === appName), 120000, { afterId: afterIds[holder] },
    );
    expect(announced.unannounced, 'the upgraded holder announced the app it has no hash for').to.deep.equal([unhashed]);
    await storedFrom(NOT_UPGRADED, afterIds[NOT_UPGRADED], holder, appName)
      .catch(() => { throw new Error('the node not yet upgraded stored no announcement from the upgraded holder since the unhashed app was installed'); });
  });

  it('a node not yet upgraded announces the app, and the upgraded nodes store the rest and refuse it', async function () {
    this.timeout(420000);
    const appName = `e2erollbase${stamp}`;
    const holder = NOT_UPGRADED;
    const { unhashed, afterIds } = await holderWithUnhashedApp(appName, holder);

    await Promise.all(UPGRADED.map(async (i) => {
      const { data: stored } = await storedFrom(i, afterIds[i], holder, appName)
        .catch(() => { throw new Error(`upgraded node ${i} stored no announcement from the node not yet upgraded since the unhashed app was installed`); });
      expect(stored.apps.map((a) => a.name)).to.include(appName);
      expect(stored.refused, `upgraded node ${i} did not refuse the app without a hash`).to.deep.equal([unhashed]);
      expect(await dbClient(i + 1).appLocationAt(unhashed, socketAddr(holder + 1)), `upgraded node ${i} holds a row for the app without a hash`).to.equal(null);
    }));
  });
});
