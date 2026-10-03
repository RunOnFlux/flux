// The harness firewall switch: a firewalled node boots with ufw active as its
// install leaves it, and FluxOS then adds its own rules on top. A legacy node
// gets the legacy installer's baseline, an Arcane node the ISO's, and a node the
// switch does not name keeps ufw off.
//
// FluxOS's own rules are what make the switch worth having: each firewalled node
// must end up with a rule only FluxOS writes, so a firewall that came up but that
// FluxOS never saw as active fails here.
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const LEGACY = 0;
const ARCANE = 1;
const UNFIREWALLED = 2;

// apiport 16127 - 5
const FLUXADM_PORT = 16122;
const FLUXOS_RULES_TIMEOUT_MS = 180000;

describe('2501 firewalled nodes', function suite() {
  this.timeout(600000);

  let env;
  dumpLogsOnFailure(() => env);

  async function ufwStatus(index) {
    const { stdout } = await execInContainer(env.clients[index].container, 'ufw status verbose; true');
    return stdout;
  }

  // Port 80 inbound is opened by FluxOS's adjustFirewall and by neither baseline.
  async function waitForFluxosRules(index) {
    await waitFor(async () => /^80\s+ALLOW IN\s+Anywhere\s*$/m.test(await ufwStatus(index)), {
      timeout: FLUXOS_RULES_TIMEOUT_MS, interval: 3000, label: `FluxOS's own firewall rules on node ${index}`,
    });
  }

  before(async function hook() {
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      legacyNodes: [LEGACY],
      firewall: [LEGACY, ARCANE],
      tickerAutostart: false,
    });
  });

  after(async () => {
    await env?.teardown();
  });

  it('boots a legacy node with the legacy installer\'s firewall', async () => {
    const status = await ufwStatus(LEGACY);
    expect(status).to.match(/^Status: active$/m);
    expect(status).to.match(/^Default: deny \(incoming\), allow \(outgoing\)/m);
    expect(status).to.match(/^22\/tcp\s+ALLOW IN\s+Anywhere\s*$/m);
    expect(status).to.match(/^16100:16199\/tcp\s+ALLOW IN\s+Anywhere\s*$/m);
    expect(status).to.match(/^22\/tcp\s+LIMIT IN\s+Anywhere\s*$/m);
    expect(status).to.match(/^53\s+ALLOW OUT\s+Anywhere\s*$/m);
  });

  it('boots an Arcane node with the ISO\'s firewall', async () => {
    const status = await ufwStatus(ARCANE);
    expect(status).to.match(/^Status: active$/m);
    expect(status).to.match(/^Default: deny \(incoming\), allow \(outgoing\), deny \(routed\)$/m);
    expect(status).to.match(/^22\/tcp\s+LIMIT IN\s+Anywhere\s*$/m);
    expect(status, 'the legacy installer\'s port range is not the ISO\'s').to.not.match(/16100:16199/);
  });

  it('lets FluxOS add its own rules on both', async () => {
    await waitForFluxosRules(LEGACY);
    await waitForFluxosRules(ARCANE);
  });

  it('opens the maintenance port by its FluxadmSSH profile on the Arcane node only', async () => {
    await waitFor(async () => new RegExp(`^${FLUXADM_PORT}/tcp \\(FluxadmSSH\\)\\s+ALLOW IN`, 'm').test(await ufwStatus(ARCANE)), {
      timeout: FLUXOS_RULES_TIMEOUT_MS, interval: 3000, label: 'the FluxadmSSH rule on the Arcane node',
    });
    expect(await ufwStatus(LEGACY)).to.not.match(/FluxadmSSH/);
  });

  it('keeps ufw off on a node the switch does not name', async () => {
    expect(await ufwStatus(UNFIREWALLED)).to.match(/^Status: inactive$/m);
  });
});
