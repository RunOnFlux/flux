// weight: heavy
/*
 * /apps/redeploycomponent, against a real composed app.
 *
 * This endpoint had never been exercised end to end — `grep -rn redeploycomponent
 * test-infra/` found nothing — and it did not work at all. Both redeploy paths
 * handed the component teardown a null docker id and the app's name already joined
 * to the component's, so the id reached getAppIdentifier and threw on
 * `null.startsWith` before any container was looked up. On the soft path that throw
 * was answered by force-uninstalling the WHOLE APP and broadcasting the removal to
 * the network. Every call. Asking to replace one container destroyed the app and
 * told every peer it was gone.
 *
 * Nothing caught it because the arguments are the whole behaviour: a unit test can
 * pin them (advancedWorkflows.test.js, 'component redeploy argument contract') but
 * it stubs docker, so it proves the right values are passed and not that a
 * container is genuinely replaced or that the app survives. That is what this is
 * for.
 *
 * TWO components, and the sibling is the point. A component redeploy that took the
 * whole app down would satisfy every assertion about the subject alone; the only
 * thing that separates "replaced one component" from "rebuilt the app" is that the
 * other component's container is the same container throughout.
 *
 * Plain non-syncthing components (containerData '/tmp'): both start immediately, so
 * no election and no sync gate sit between the request and the result. Those belong
 * to the 3xx/4xx suites.
 *
 * NOT COVERED HERE, deliberately: the tampering suppression in
 * globalState.fluxRemovedContainers. The shape it protects is a teardown that fails
 * PART WAY — container gone, app row intact, the app still reconciled — and the
 * harness cannot make a docker call fail
 * (fluxModels workstreams/test-harness/DOCKER_FAULT_INJECTION.md, "designed, not
 * built"; a composed app whose second component throws mid-teardown is listed there
 * as one of the three things it would unlock). A successful redeploy records the
 * removal and clears it moments later, so a suite over this path cannot observe the
 * mark at all, and a test asserting "no tampering event" here would pass with the
 * suppression removed. It is unit-proved only (appReconciler.test.js, 'recreates a
 * container FluxOS removed itself without calling it tampering'). What IS covered
 * is the regression that change could cause: an absence FluxOS did not create must
 * still be reported, which is the last test below.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { pushImage } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { getAppContainerId, killAppContainer, listAppContainers } from '../framework/container.js';
import { waitFor, waitForComponentRedeployed, waitForReconcileActuated } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

describe('a component redeploy replaces that component and leaves the app alone', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2ecompredep${Date.now()}`;
  const subject = `${appName}a`;
  const sibling = `${appName}b`;

  // The node holding the app, and a second one that only ever watches: a removal
  // broadcast is a claim made to the FLEET, so its absence has to be checked
  // somewhere other than the node that would have sent it.
  let holder;
  let observer;
  let auth;

  // Reads the tampering rows the DOS decision actually scores. The route carries
  // `cache('30 seconds')` and apicache keys on the URL alone — it answers before
  // the handler runs — so a repeated poll would keep being handed the first
  // answer. The unique parameter is what makes each read a fresh one, the same
  // way the framework's getDOSState does it.
  async function tamperingEvents(client, name) {
    const res = await client.get(`/apps/tamperingevents/${name}?_=${Date.now()}`);
    expect(res.status, `tamperingevents refused: ${JSON.stringify(res)}`).to.equal('success');
    return res.data;
  }

  // By EXACT container name. getAppContainerStatus matches on a substring of the
  // app name, so with two components it answers about whichever docker lists
  // first - which is not a question this suite ever wants to ask.
  async function componentStatus(client, componentName) {
    const containers = await listAppContainers(client.container, { all: true });
    return containers.find((c) => c.name === `flux${componentName}_${appName}`) ?? null;
  }

  before(async function () {
    this.timeout(420000);

    env = await createTestEnv({ hookCtx: this, nodes: 10, tickerAutostart: false });
    await bootAndPeer(env);
    [holder, observer] = [env.clients[0], env.clients[1]];

    await pushImage(appName, 'v1');
    const component = (name) => ({
      name,
      description: 'component redeploy test container',
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
    });
    const app = await buildSeedableApp({
      env,
      name: appName,
      compose: [component(subject), component(sibling)],
    });

    await installOnNodes(env, app, [0]);
    // Both components UP before anything is measured: an id recorded off a
    // container that had not started yet would change on its own, and the suite
    // would report a redeploy that never happened.
    await Promise.all([subject, sibling].map((name) => waitFor(
      async () => (await componentStatus(holder, name))?.status?.startsWith('Up'),
      { timeout: 120000, interval: 2000, label: `${name} running before the redeploy` },
    )));

    auth = await authenticate(holder.url, appOwnerKey());
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('replaces the requested component and never touches its sibling', async function () {
    this.timeout(300000);

    const wasRunning = {
      subject: await getAppContainerId(holder.container, appName, subject),
      sibling: await getAppContainerId(holder.container, appName, sibling),
    };
    expect(wasRunning.subject, 'subject container missing before the redeploy').to.be.a('string');
    expect(wasRunning.sibling, 'sibling container missing before the redeploy').to.be.a('string');

    // Anchored on both nodes' current position in their event streams. waitForEvent
    // answers from the buffer, so an unanchored wait would be satisfied by the
    // install's own events from before().
    const holderFrom = holder.getLastEventId();
    const observerFrom = observer.getLastEventId();

    const body = await holder.redeployComponent(appName, subject, auth.zelidauth);
    expect(body, `redeploycomponent refused: ${body.slice(-600)}`).to.not.match(/Unauthorized|"status"\s*:\s*"error"/i);

    await waitForComponentRedeployed(holder, appName, subject, false, 240000, { afterId: holderFrom });

    const nowRunning = {
      subject: await getAppContainerId(holder.container, appName, subject),
      sibling: await getAppContainerId(holder.container, appName, sibling),
    };

    // A DIFFERENT container, which is the only evidence that separates a redeploy
    // from a restart — name, status and image read the same either way.
    expect(nowRunning.subject, 'the redeployed component has no container').to.be.a('string');
    expect(nowRunning.subject, 'the component was not actually replaced').to.not.equal(wasRunning.subject);

    // The whole point of a COMPONENT redeploy. Before the argument fix the app was
    // force-uninstalled here, so this container did not exist at all.
    expect(nowRunning.sibling, 'the sibling was destroyed by a component redeploy').to.equal(wasRunning.sibling);

    // Both of them, by name: the replaced one has to come back up, and the
    // sibling has to have stayed up.
    for (const name of [subject, sibling]) {
      // eslint-disable-next-line no-await-in-loop
      await waitFor(
        async () => (await componentStatus(holder, name))?.status?.startsWith('Up'),
        { timeout: 120000, interval: 2000, label: `${name} running after the redeploy` },
      );
    }

    const installed = await holder.getInstalledApps();
    expect(installed.status).to.equal('success');
    expect(
      installed.data.some((app) => app.name === appName),
      'the app was uninstalled by a request to redeploy one of its components',
    ).to.equal(true);

    // Locally: nothing announced the app as removed.
    const removedHere = holder.getEventBuffer()
      .filter((e) => e.id > holderFrom && e.event === 'app:removed' && e.data.name === appName);
    expect(removedHere, `the node removed ${appName} during a component redeploy`).to.have.lengthOf(0);

    // And on the fleet: fluxappremoved reaches peers as network:appremoved, so a
    // watching node is where "the network was told" is either true or false. This
    // is the assertion that used to fail — a component redeploy broadcast the app's
    // removal to every peer.
    const removedOnFleet = observer.getEventBuffer()
      .filter((e) => e.id > observerFrom && e.event === 'network:appremoved' && e.data.name === appName);
    expect(
      removedOnFleet,
      `a peer was told ${appName} had been removed: ${JSON.stringify(removedOnFleet.map((e) => e.data))}`,
    ).to.have.lengthOf(0);
  });

  it('leaves no tampering event behind', async function () {
    this.timeout(60000);

    // Runs BEFORE the removal below, which deliberately records one — tampering
    // rows are keyed by app, not by component, so the order is load-bearing.
    //
    // This is not the suppression's proof (see the header): the reconciler stands
    // down for the whole redeploy on globalState.isOperationInProgress(), so it
    // never sees the container absent and would record nothing either way. What it
    // pins is the end state a redeploy is allowed to leave: a node must not have
    // accused the app it just serviced. It goes red if that stand-down is ever
    // narrowed without the removal record covering the gap.
    const events = await tamperingEvents(holder, appName);
    expect(
      events.filter((e) => e.eventType === 'container_vanished'),
      `a redeploy left tampering events on ${appName}: ${JSON.stringify(events)}`,
    ).to.have.lengthOf(0);
  });

  it('still reports a container that vanished without FluxOS removing it', async function () {
    this.timeout(300000);

    // The regression the removal record could cause, and the reason it is keyed on
    // the container rather than set for a window: an absence FluxOS did NOT create
    // is the strongest local evidence of host-side interference the node has, and
    // it must still be reported. `docker rm -f` from outside FluxOS is that
    // absence — it never passes through appDockerRemove, so nothing records it as
    // ours.
    const from = holder.getLastEventId();
    const killed = await killAppContainer(holder.container, appName, sibling);
    expect(killed.exitCode, `could not remove the container: ${killed.output}`).to.equal(0);

    await waitForReconcileActuated(holder, `${sibling}_${appName}`, 'recreated', 180000, { afterId: from });

    // Polled rather than read once: the recreate and the event write are separate
    // steps, and the event is what the tamper score is computed from.
    await waitFor(async () => {
      const events = await tamperingEvents(holder, appName);
      return events.some((e) => e.eventType === 'container_vanished');
    }, { timeout: 60000, interval: 2000, label: `container_vanished recorded for ${appName}` });

    const events = await tamperingEvents(holder, appName);
    const vanished = events.find((e) => e.eventType === 'container_vanished');
    // Severity is what the DOS decision sums, so it is part of the signal and not
    // decoration: appTamperingDetectionService weights this event 3 against a
    // threshold of 10.
    expect(vanished.severity, 'container_vanished recorded without its weight').to.equal(3);
    expect(vanished.appName).to.equal(appName);
  });
});
