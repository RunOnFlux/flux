import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, getAppContainerStatus } from '../framework/container.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableLegacyApp } from '../framework/seed-helper.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// A version <= 3 app has no compose array: its one component's fields sit flat
// on the specification. The restore reached for `.compose` and threw before it
// did anything at all, so restoring a legacy app has never worked - and nothing
// in the harness could show that, because seed-helper built v8 everywhere.
//
// The legacy component is addressed as the literal 'null' - the name
// IOUtils.getVolumeInfo and the syncthing folder ids both use for it - and the
// archive is named for it too. Getting that wrong is the whole of the bug, so
// what this asserts is that a restore asked for a legacy app finds its volume,
// finds its archive, and replaces its data.

describe('a restore of a legacy app, which has no compose array', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2eleg${ts}`;
  // a v<=3 app's directory and folder id are the app name, with no component
  const dir = `/mnt/appdata/flux-apps/flux${appName}`;

  let auth;
  let client;

  async function readFile(path) {
    const r = await execInContainer(client.container, `cat "${path}" 2>/dev/null || echo missing`);
    return r.stdout.trim();
  }

  before(async function () {
    this.timeout(480000);
    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: { minOutgoing: 1, minIncoming: 1 },
      },
    });
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });
    client = env.clients[0];

    await pushImage(appName, 'v1');
    const app = await buildSeedableLegacyApp({ name: appName, containerData: '/appdata' });
    expect(app.spec.compose, 'a legacy spec must have no compose array').to.equal(undefined);
    expect(app.spec.version, 'legacy version').to.be.at.most(3);

    await installOnNodes(env, app, [0]);
    // no sync flag, so no dataCleared - the container being up is the readiness
    await waitFor(async () => {
      const status = await getAppContainerStatus(client.container, appName);
      return Boolean(status && /up/i.test(status.status ?? ''));
    }, { timeout: 180000, interval: 3000, label: 'legacy app container running' });

    auth = await authenticate(client.url, appOwnerKey());
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  it('finds the volume and archive of a component that has no name, and replaces its data', async function () {
    this.timeout(300000);
    const r = await execInContainer(client.container,
      `mkdir -p ${dir}/appdata && printf 'legacy-original\\n' > ${dir}/appdata/marker.txt `
      + '&& rm -rf /tmp/leg && mkdir -p /tmp/leg && printf \'legacy-restored\\n\' > /tmp/leg/restored.txt '
      + `&& mkdir -p ${dir}/backup/local && tar -czf ${dir}/backup/local/backup_null.tar.gz -C /tmp/leg .`);
    expect(r.exitCode, `staging the legacy app failed: ${r.output}`).to.equal(0);

    const body = await client.appendRestoreTask(
      appName, [{ component: 'null', restore: true }], 'local', auth.zelidauth,
    );
    expect(body).to.not.match(/Unauthorized/i);
    // the failure this replaces was a throw on .compose, before any work
    expect(body).to.not.match(/compose/i);
    expect(body).to.match(/Finalizing/);

    expect(await readFile(`${dir}/appdata/restored.txt`)).to.equal('legacy-restored');
    expect(await readFile(`${dir}/appdata/marker.txt`)).to.equal('missing');
  });

  it('refuses a component name a legacy app does not have', async function () {
    this.timeout(300000);
    const before = await readFile(`${dir}/appdata/restored.txt`);

    const body = await client.appendRestoreTask(
      appName, [{ component: appName, restore: true }], 'local', auth.zelidauth,
    );

    // its only component is 'null'; anything else names nothing, and the
    // validation happens before any data is touched
    expect(body).to.match(/Refused/i);
    expect(await readFile(`${dir}/appdata/restored.txt`)).to.equal(before);
  });
});
