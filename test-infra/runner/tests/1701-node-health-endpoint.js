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
//
// Both node types, because the syncthing term is the one that differs and a
// fleet of one type cannot see it. That check is held to nodes whose syncthing
// FluxOS owns, so on Arcane it is carved out entirely - and booting the default
// node type, which is Arcane, ran the endpoint without ever reaching the branch
// that decides anything.

const FLEETS = [
  { name: 'legacy, where syncthing decides fitness', options: { nodes: 1, legacyNodes: [0] } },
  { name: 'Arcane, where that check is carved out', options: { nodes: 1 } },
];

FLEETS.forEach(({ name, options }) => {
  describe(`Node health: GET /flux/health - ${name}`, function () {
    let env;
    let node;

    dumpLogsOnFailure(() => env);

    before(async function () {
      this.timeout(120000);
      env = await createTestEnv({ hookCtx: this, ...options });
      [node] = env.clients;
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
});
