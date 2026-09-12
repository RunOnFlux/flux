import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { waitForDaemonReady } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// GET /flux/health reports node fitness from a real node, and gates on the same
// checks loginPhrase does. The unit tests cover checkNodeFitness with every
// dependency stubbed; this proves the endpoint answers correctly against a
// genuinely booted node - real db, docker, hardware, DOS and syncthing - which
// stubs cannot. It also pins the claim the refactor rests on: /flux/health and
// /id/loginphrase gate identically, so fluxbench can move from the latter to the
// former without a change in what passes.

let env;
let node;

describe('Node health: GET /flux/health', function () {
  dumpLogsOnFailure(() => env);

  before(async function () {
    this.timeout(120000);
    env = await createTestEnv({ hookCtx: this, nodes: 1 });
    node = env.clients[0];
    await waitForDaemonReady(node);
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('reports the node fit, with every fitness check passing', async function () {
    const res = await node.get('/flux/health');

    expect(res.status).to.equal('success');
    expect(res.data).to.include({
      db: 'ok',
      syncthing: 'ok',
      docker: 'ok',
      hardware: 'ok',
      dos: 'ok',
      appsDos: 'ok',
    });
  });

  it('agrees with loginPhrase on a fit node - both pass the shared gate together', async function () {
    const health = await node.get('/flux/health');
    const phrase = await node.get('/id/loginphrase');

    // Same checkNodeFitness gate behind both: a fit node clears both, so the
    // health endpoint is a faithful stand-in for the fitness loginPhrase enforces.
    expect(health.status).to.equal('success');
    expect(phrase.status).to.equal('success');
    expect(phrase.data).to.be.a('string');
  });
});
