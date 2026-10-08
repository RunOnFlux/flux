import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { nodeKey } from '../framework/keys.js';
import { buildAppSpec, registerAndConfirm } from '../framework/app-helper.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { restartFluxos } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A restarting node rebuilds its application registry once its boot hash sync
// completes, and refills its location store from the orchestrator's state sync.
// Until each stands, the routes a director reads the network from answer 503
// with a Retry-After, and once it stands they answer the whole of it. There is
// no third answer: never a 200 carrying an empty or partial list, which a
// caller such as FDM cannot tell from a network with fewer apps.
//
// Driven by restartFluxos, which kills only the FluxOS process and leaves mongo
// and the registry exactly where the node left them - the `systemctl restart
// fluxos` an operator performs, and the path that runs the boot rebuild.

const NODES = 4;
const APPS = 3;
const RESTARTED = 0;
const POLL_MS = 200;

describe('registry and location reads wait for their store after a restart', function () {
  let env;
  const appNames = [];

  dumpLogsOnFailure(() => env);

  // One read, with the status the node answered and the length of any list.
  const read = async (path) => {
    const res = await fetch(`${env.clients[RESTARTED].url}${path}`);
    const body = await res.json().catch(() => null);
    return {
      status: res.status,
      // FluxOS reports a handler's own failure as a 200 whose body says error; a
      // caller acts only on a body that says success.
      success: res.status === 200 && body?.status === 'success',
      retryAfter: res.headers.get('retry-after'),
      listed: Array.isArray(body?.data) ? body.data.length : null,
      names: Array.isArray(body?.data) ? body.data.map((a) => a.name) : [],
    };
  };

  before(async function () {
    this.timeout(600000);
    env = await createTestEnv({ hookCtx: this, nodes: NODES, tickerAutostart: false });
    await bootAndPeer(env);
    for (let i = 0; i < APPS; i += 1) {
      const name = `e2eregistrywait${i}${Date.now()}`;
      // eslint-disable-next-line no-await-in-loop
      const result = await registerAndConfirm(env.clients[0].url, nodeKey(1), buildAppSpec({ name }), env.clients);
      expect(result.status, JSON.stringify(result)).to.equal('success');
      appNames.push(name);
    }
    await waitFor(async () => {
      const r = await read('/apps/globalappsspecifications');
      return r.status === 200 && appNames.every((n) => r.names.includes(n));
    }, { timeout: 180000, interval: 3000, label: 'every app in the restarted node\'s registry before the restart' });
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  // Both routes are sampled together from the moment the node is back, so each
  // one's window is observed rather than assumed. No app runs in this fleet, so
  // an empty location list is a correct answer: for locations the contract is
  // the status, and for the registry it is the status and the whole list.
  it('answers 503 until each store stands, then the whole of it, and never a short list', async function () {
    this.timeout(420000);
    await restartFluxos(env.clients[RESTARTED].container);

    const registry = [];
    const locations = [];
    await waitFor(async () => {
      const [r, l] = await Promise.all([read('/apps/globalappsspecifications'), read('/apps/locations')]);
      registry.push(r);
      locations.push(l);
      return registry.some((x) => x.success) && locations.some((x) => x.success);
    }, { timeout: 360000, interval: POLL_MS, label: 'the registry and locations answering 200 again' });

    // Each window has to have been seen at all, or "never a short list" is true
    // of a poll that started after the store already stood.
    expect(registry.filter((r) => r.status === 503).length, 'a registry read landed before it stood').to.be.greaterThan(0);
    expect(locations.filter((r) => r.status === 503).length, 'a location read landed before they were synced').to.be.greaterThan(0);

    [...registry, ...locations].filter((r) => r.status === 503).forEach((r) => {
      expect(r.retryAfter, 'a refusal says when to come back').to.equal('15');
    });
    expect([...registry, ...locations].filter((r) => r.status !== 503 && r.status !== 200).map((r) => r.status))
      .to.deep.equal([]);
    registry.filter((r) => r.success).forEach((r) => {
      expect(appNames.every((n) => r.names.includes(n)), `a successful answer listed ${r.listed} apps`).to.equal(true);
    });
  });

  it('keeps answering the whole registry once it stands', async () => {
    const r = await read('/apps/globalappsspecifications');
    expect(r.success).to.equal(true);
    expect(appNames.every((n) => r.names.includes(n))).to.equal(true);
  });
});
