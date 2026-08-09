// The fleet has no route off itself, and this is what says so out loud.
//
// Closing the network is the easy half. On its own it turns a hardcoded address
// into a timeout, and a timeout reads as a slow test - which is how the harness
// spent months reaching stats.runonflux.io and api.github.com on every boot
// without anyone noticing. The resolver refuses unknown names immediately and
// records who asked, so the next address someone hardcodes fails here, naming
// itself, at the moment it is written.
//
// A boot is the window that matters: it is where a node fetches its module
// versions, its rates, its policy, its geolocation and - on a legacy node - its
// packages. Both node types boot here because they reach for different things:
// monitorSystem returns immediately on Arcane, so only the legacy node exercises
// the apt path at all.
import { describe, it, before, after } from 'mocha';
import { createTestEnv } from '../framework/test-env.js';
import { expectNoUnexpectedDns, resetDnsAttempts, dnsAttempts } from '../framework/external-http-control.js';
import { waitForPackagesChecked, waitForBootSettled } from '../framework/wait.js';
import { execInContainer } from '../framework/container.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

describe('95 the fleet reaches nothing outside itself', function suite() {
  this.timeout(600000);

  describe('a legacy node', () => {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function hook() {
      env = await createTestEnv({
        hookCtx: this, nodes: 1, legacyNodes: [0], tickerAutostart: false,
      });
      // From here on, what is recorded is this fleet's doing.
      await resetDnsAttempts();
    });

    after(async () => {
      await env?.teardown();
    });

    it('asks for nothing the fleet cannot answer, through a whole boot', async () => {
      // Waited for rather than sampled: the package checks are the last thing a
      // legacy boot does, and asserting before they run would pass on a node that
      // simply had not reached out yet.
      await waitForPackagesChecked(env.clients[0]);
      await waitForBootSettled(env.clients[0]);

      await expectNoUnexpectedDns();
    });
  });

  describe('an arcane node', () => {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function hook() {
      env = await createTestEnv({
        hookCtx: this, nodes: 1, tickerAutostart: false,
      });
      await resetDnsAttempts();
    });

    after(async () => {
      await env?.teardown();
    });

    it('asks for nothing the fleet cannot answer, through a whole boot', async () => {
      await waitForBootSettled(env.clients[0]);

      await expectNoUnexpectedDns();
    });

    it('records the name and the node when something does reach out', async () => {
      // The instrument, proven on this fleet rather than assumed. A resolver that
      // silently answered everything would leave the assertion above green for the
      // rest of time, and nothing else in this suite would notice.
      await resetDnsAttempts();
      await execInContainer(
        env.clients[0].container,
        'getent hosts stats.runonflux.io >/dev/null 2>&1 || true',
      );

      const attempts = await dnsAttempts();
      const seen = attempts.find((a) => a.name === 'stats.runonflux.io');
      if (!seen) throw new Error('the resolver recorded nothing for a name the fleet does not serve');
      if (!seen.node) throw new Error('the recorded attempt does not say which node asked');
    });
  });
});
