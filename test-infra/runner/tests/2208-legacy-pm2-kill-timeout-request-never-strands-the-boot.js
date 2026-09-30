import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, pm2Registration } from '../framework/container.js';
import { bootAndPeer } from '../framework/reconciler-suite.js';
import { waitFor } from '../framework/wait.js';
import { isDaemonUp } from '../framework/syncthing-real.js';
import { sleepUnlessInfraDead } from '../framework/infra-death.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// fleet: 3
//
// A legacy node whose FluxOS pm2 runs with a kill timeout shorter than the
// shutdown needs: at boot FluxOS asks pm2 to restart it with the longer one,
// and waits for that restart. Two ways the request can go wrong, and neither
// may leave the node without a booted FluxOS:
//
//   - pm2 cannot restart FluxOS. The command that asked tells FluxOS, and
//     FluxOS boots on with the kill timeout it has.
//   - pm2 restarts FluxOS and keeps the short kill timeout. FluxOS asked on
//     this machine boot already, so it boots on rather than asking again.
//
// The node's pm2 is wrapped for both: `restart` fails, or runs without its
// --kill-timeout, and every other command reaches pm2. That FluxOS booted on
// is read from the syncthing sentinel starting, which comes after the request
// in the boot.

const SHORT_MS = 1600;
const REQUEST_MARKER = '/root/.flux-pm2-kill-timeout-request';
// How long a restart loop would take to show itself: pm2 restarts FluxOS
// within seconds of being asked.
const QUIET_MS = 45000;

describe('a legacy node\'s request for a longer pm2 kill timeout never strands its boot', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const PM2 = 0;
  const client = (i) => env.clients[i];
  const sh = async (command) => execInContainer(client(PM2).container, command);
  let realPm2;

  // What the wrapped pm2 does with `restart`: 'fail', 'drop-kill-timeout', or
  // anything else to pass it through.
  const wrapperMode = async (mode) => {
    const r = await sh(`printf '%s' '${mode}' > /tmp/pm2-wrapper-mode`);
    expect(r.exitCode, `fixture: ${r.output}`).to.equal(0);
  };

  // The registration as the multitool made it before it set a kill timeout,
  // with no request recorded for this boot: FluxOS asks as it restarts.
  const registerShort = async () => {
    const r = await sh(`rm -f ${REQUEST_MARKER} && ${realPm2} restart flux --kill-timeout ${SHORT_MS} >/dev/null && ${realPm2} save >/dev/null`);
    expect(r.exitCode, `fixture: ${r.output}`).to.equal(0);
  };

  // No restart of FluxOS for QUIET_MS, and the kill timeout still short.
  const holdsStill = async (restarts) => {
    const deadline = Date.now() + QUIET_MS;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const registration = await pm2Registration(client(PM2).container);
      expect(registration.restarts, 'restarts of FluxOS').to.equal(restarts);
      expect(registration.live, 'the kill timeout pm2 holds').to.equal(SHORT_MS);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(3000);
    }
  };

  before(async function () {
    this.timeout(900000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      legacyNodes: [PM2],
      pm2Nodes: { [PM2]: null },
      syncthing: 'binary',
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    await waitFor(() => isDaemonUp(client(PM2)), { timeout: 300000, interval: 3000, label: 'syncthing daemon up on the pm2 node' });
    await waitFor(async () => (await pm2Registration(client(PM2).container)).live === 60000, {
      timeout: 120000, interval: 2000, label: 'fixture: FluxOS raised pm2\'s default kill timeout at its first boot',
    });

    realPm2 = (await sh('readlink -f "$(command -v pm2)"')).stdout.trim();
    const wrapped = await sh(`p="$(command -v pm2)" && mv "$p" "$p.real" && cat > "$p" <<'EOF'
#!/bin/sh
real="$0.real"
if [ "$1" = restart ]; then
  case "$(cat /tmp/pm2-wrapper-mode 2>/dev/null)" in
    fail) echo "pm2 restart refused" >&2; exit 1 ;;
    drop-kill-timeout) exec "$real" restart "$2" ;;
  esac
fi
exec "$real" "$@"
EOF
chmod 755 "$p"`);
    expect(wrapped.exitCode, `fixture: ${wrapped.output}`).to.equal(0);
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('boots on with the kill timeout it has when pm2 cannot restart it', async function () {
    this.timeout(420000);
    await wrapperMode('fail');
    const mark = client(PM2).getLastEventId();
    await registerShort();
    const restarts = (await pm2Registration(client(PM2).container)).restarts;

    const failed = await client(PM2).waitForEvent('pm2:killTimeoutRaiseFailed', () => true, 180000, { afterId: mark });
    expect(failed.data, 'the kill timeout FluxOS boots with').to.deep.equal({ killTimeout: SHORT_MS });
    await client(PM2).waitForEvent('syncthing:ownersByNumber', () => true, 180000, { afterId: failed.id });

    await holdsStill(restarts);
  });

  it('asks once per machine boot, and boots on when pm2 keeps the short kill timeout', async function () {
    this.timeout(420000);
    await wrapperMode('drop-kill-timeout');
    const mark = client(PM2).getLastEventId();
    await registerShort();
    const restarts = (await pm2Registration(client(PM2).container)).restarts;

    const unchanged = await client(PM2).waitForEvent('pm2:killTimeoutUnchanged', () => true, 240000, { afterId: mark });
    expect(unchanged.data, 'the kill timeout FluxOS boots with').to.deep.equal({ killTimeout: SHORT_MS });
    await client(PM2).waitForEvent('syncthing:ownersByNumber', () => true, 180000, { afterId: unchanged.id });

    // FluxOS's one request restarted it once.
    await holdsStill(restarts + 1);
  });
});
