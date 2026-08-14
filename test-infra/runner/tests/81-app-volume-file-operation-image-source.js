import { describe, it, before, beforeEach, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import {
  pushImage, mirrorExecutorImage, executorImageReference, executorAcceptedIds,
} from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { waitFor, waitForOperation } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import {
  volumeRoot, resetVolume, seedVolumeTree, exists,
} from '../framework/volume-fixture.js';

// Where a node gets the executor image, which decides whether it has a file
// browser at all: createfolder used to be a local mkdir and now needs a
// container. One registry is not a guarantee that a node can reach one, so a
// node asks the fleet as well - and the fleet is only an answer if the image
// really moves between nodes, which is what nothing but this exercises.
//
// The unit tests stub docker, the network and the peers, so they prove the
// decisions and nothing about a real image crossing a real wire.

describe('app volume file operations - where the image comes from', function () {
  let env;
  let auth;
  let executorImage;
  dumpLogsOnFailure(() => env);

  const ts = Date.now();
  const appName = `e2efileimg${ts}`;
  const root = volumeRoot(appName);

  const post = (node, path, body) => node.request('POST', path, { body, headers: { zelidauth: auth.zelidauth } });
  const get = (node, path) => node.request('GET', path, { headers: { zelidauth: auth.zelidauth } });

  const inNode = (index, command) => execInContainer(env.clients[index].container, command);

  // Which identifier THIS node's daemon files the image under, asked of the
  // node rather than assumed from the host. The pin carries one config digest
  // per architecture and one index digest, and a daemon resolves whichever its
  // image store uses - the classic one the config digest, the containerd one
  // the index digest. Probing for the wrong one answers "not held" about an
  // image the node is holding perfectly well, which is how this suite reported
  // that a working peer transfer had never arrived.
  const executorIds = new Map();
  async function executorIdFor(index) {
    if (!executorIds.has(index)) {
      const arch = (await inNode(index, 'docker version --format "{{.Server.Arch}}"')).stdout.trim();
      const accepted = executorAcceptedIds(arch);
      expect(accepted, `FIXTURE: the pin names no image for ${arch}`).to.not.be.empty;
      executorIds.set(index, accepted);
    }
    return executorIds.get(index);
  }

  // The one it actually holds, or the first as the thing to remove/report.
  async function heldIdOn(index) {
    const accepted = await executorIdFor(index);
    for (const id of accepted) {
      const r = await inNode(index, `docker image inspect ${id} >/dev/null 2>&1; echo $?`);
      if (r.stdout.trim() === '0') return id;
    }
    return null;
  }

  // By ID, which is the predicate the node itself decides on. Asking by TAG
  // asks a different question: a peer serves the archive addressed by id, and
  // the daemon writes no names for a reference that carries none, so an image
  // that crossed the wire perfectly is held under no name at all. This probe
  // used to report that as "the image never arrived" - the peer test failing on
  // the one path it exists to prove.
  async function imageHeldOn(index) {
    return await heldIdOn(index) !== null;
  }

  // Every image the node holds, so what an archive BROUGHT can be told apart
  // from what was already there. A peer answers with a tar of its own making,
  // and anything it packed in beside the image that was asked for is on this
  // node afterwards with nothing that would ever look at it again.
  async function imageIdsOn(index) {
    const r = await inNode(index, 'docker images --no-trunc --format "{{.ID}}"');
    return new Set(r.stdout.trim().split('\n').filter(Boolean));
  }

  // Removed by ID for the same reason it is probed by one, and under every
  // identifier: a copy that came from a peer carries no name, so removing the
  // tag leaves the image itself sitting there and the next test starts with the
  // node already holding what it was supposed to be missing.
  async function forgetImageEverywhere() {
    await Promise.all(env.clients.map(async (_, index) => {
      const accepted = await executorIdFor(index);
      for (const id of accepted) {
        await inNode(index, `docker rmi -f ${id} >/dev/null 2>&1 || true`);
      }
    }));
  }

  async function giveImageTo(index) {
    const r = await inNode(index, `docker pull ${executorImage}`);
    expect(r.exitCode, `FIXTURE: node ${index} could not be given the image: ${r.output}`).to.equal(0);
  }

  // REJECT rather than DROP: an unreachable registry is the condition under
  // test, and a silently dropped packet only tests how long a pull waits.
  async function cutOffRegistry(index) {
    const r = await inNode(index, 'iptables -I OUTPUT -d $(getent hosts fluxregistry | awk \'{print $1}\') -j REJECT');
    expect(r.exitCode, `FIXTURE: could not cut node ${index} off from the registry`).to.equal(0);
  }

  async function restoreRegistry(index) {
    await inNode(index, 'iptables -D OUTPUT -d $(getent hosts fluxregistry | awk \'{print $1}\') -j REJECT || true');
  }

  before(async function () {
    this.timeout(600000);
    executorImage = executorImageReference();

    env = await createTestEnv({
      hookCtx: this,
      nodes: 3,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          volumeOperations: {
            image: executorImage,
            // Far enough out that no node reaches its own registry slot during
            // the suite: what is being watched here is where an operation gets
            // the image, not the background fetch racing it.
            prefetchWindowMs: 24 * 60 * 60 * 1000,
          },
        },
      },
    });
    await mirrorExecutorImage();
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
        description: 'where the file operation image comes from',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [31811],
        domains: [''],
        environmentParameters: [],
        commands: [],
        containerPorts: [80],
        containerData: '/appdata',
        cpu: 0.1,
        ram: 100,
        hdd: 3,
        repoauth: '',
      }],
    });
    await installOnNodes(env, app, [0]);

    auth = await authenticate(env.clients[0].url, appOwnerKey());
    await waitFor(async () => exists(env.clients[0].container, root), {
      timeout: 60000, interval: 2000, label: 'app volume mounted',
    });
  });

  after(async function () {
    this.timeout(30000);
    await env?.teardown();
  });

  beforeEach(async function () {
    this.timeout(120000);
    await restoreRegistry(0);
    await resetVolume(env.clients[0].container, appName);
    await seedVolumeTree(env.clients[0].container, appName, { 'photos/a.txt': 'first' });
  });

  it('takes the image from the node that has it when the registry cannot be reached', async function () {
    this.timeout(300000);
    await forgetImageEverywhere();
    await giveImageTo(2);
    await cutOffRegistry(0);
    expect(await imageHeldOn(0), 'FIXTURE: node 0 still holds the image').to.equal(false);
    const heldBefore = await imageIdsOn(0);
    const acquisition = env.clients[0].waitForEvent('fileoperation:imageAcquired', () => true, 240000);

    const accepted = await post(env.clients[0], '/apps/copyobject', {
      appname: appName, component: appName, source: 'photos', destination: 'copied',
    });
    expect(accepted.status, JSON.stringify(accepted.data)).to.equal(202);
    const job = await waitForOperation(env.clients[0], accepted.data.data.jobId, auth.zelidauth, { timeout: 240000 });

    expect(job.status, JSON.stringify(job.error)).to.equal('Succeeded');
    expect(await imageHeldOn(0), 'the image never arrived').to.equal(true);

    // The image ARRIVING is not the whole contract, and it is the one thing
    // this test could otherwise see. The node re-checks its own store after the
    // transfer, so it ends up holding the image whether the peer's archive was
    // read correctly or not - the node says which of those happened.
    // .data because waitForEvent resolves the whole entry - {id, event, data} -
    // and the payload is inside it, which is the idiom every other suite uses.
    // Read without it, every field is undefined and the assertion below reports
    // a working peer transfer as one the node did not recognise.
    const acquired = (await acquisition).data;
    expect(acquired.source, 'the archive a peer sent was not read as holding the image').to.equal('peer');

    // And it stopped once a peer supplied it. Not `=== 1`: the peer is DRAWN at
    // random from the network state - which includes this node, since the draw
    // is made without excluding it - so on a three-node fleet the node holding
    // the image is the first draw only about a third of the time. Pinning the
    // count to one made this fail two runs in three for a reason that is not
    // the product. What the count can honestly say is that the search ended
    // rather than running on past the answer, which is the misread-archive
    // symptom: a node that did not recognise what it was sent goes on asking
    // for something it is already holding, to the attempt ceiling.
    expect(acquired.asked, `asked ${acquired.asked} peers on a fleet of ${env.clients.length}`)
      .to.be.within(1, env.clients.length);

    // Nothing came with it. An archive can carry more than one image, and one
    // carrying a name the sender chose is worse than one that does not.
    const arrived = [...await imageIdsOn(0)].filter((id) => !heldBefore.has(id));
    expect(arrived, `node 0 gained images it never asked for: ${arrived.join(', ')}`).to.have.lengthOf(1);
  });

  it('falls back to the registry when no peer has it', async function () {
    this.timeout(300000);
    await forgetImageEverywhere();
    expect(await imageHeldOn(0), 'FIXTURE: node 0 still holds the image').to.equal(false);

    const accepted = await post(env.clients[0], '/apps/copyobject', {
      appname: appName, component: appName, source: 'photos', destination: 'copied',
    });
    expect(accepted.status, JSON.stringify(accepted.data)).to.equal(202);
    const job = await waitForOperation(env.clients[0], accepted.data.data.jobId, auth.zelidauth, { timeout: 240000 });

    expect(job.status, JSON.stringify(job.error)).to.equal('Succeeded');
    expect(await imageHeldOn(0)).to.equal(true);
  });

  it('answers a folder request 503 with a Retry-After when nothing can supply it', async function () {
    this.timeout(300000);
    // createfolder runs the operation inline rather than registering a job, so
    // a node that cannot get the image answers the caller directly - which is
    // the whole reason a caller is given a deadline rather than the fetch's.
    await forgetImageEverywhere();
    await cutOffRegistry(0);

    const started = Date.now();
    const refused = await get(env.clients[0], `/apps/createfolder/${appName}/${appName}/${encodeURIComponent('photos/later')}`);
    const took = Date.now() - started;

    expect(refused.status).to.equal(503);
    expect(refused.headers['retry-after'], 'no Retry-After to act on').to.not.equal(undefined);
    // The caller's deadline, not the fetch's: four peers at two minutes each
    // plus a registry attempt is minutes, and nobody clicking a button waits.
    expect(took, `answered in ${took}ms`).to.be.below(60000);
  });

  it('succeeds once a peer has it, without the node being restarted', async function () {
    this.timeout(300000);
    await forgetImageEverywhere();
    await cutOffRegistry(0);
    const refused = await get(env.clients[0], `/apps/createfolder/${appName}/${appName}/${encodeURIComponent('photos/first')}`);
    expect(refused.status, 'FIXTURE: the node could still get the image').to.equal(503);

    await giveImageTo(1);
    // Past the window in which a failed attempt answers callers without
    // searching again.
    await new Promise((resolve) => { setTimeout(resolve, 61000); });

    const accepted = await get(env.clients[0], `/apps/createfolder/${appName}/${appName}/${encodeURIComponent('photos/second')}`);

    expect(accepted.status, JSON.stringify(accepted.data)).to.equal(200);
    expect(await imageHeldOn(0)).to.equal(true);
  });

  describe('handing it over', () => {
    it('refuses an id this node is not pinned to', async function () {
      this.timeout(60000);
      const other = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

      const answer = await get(env.clients[1], `/apps/fileoperationimage/${other}`);

      expect(answer.status).to.equal(404);
    });

    it('refuses an address that is not a node in the network state', async function () {
      this.timeout(120000);
      // The runner is not a Flux node, so its address is not in any node's
      // network state - which is exactly the caller the endpoint turns away.
      await giveImageTo(1);
      const pinned = await inNode(1, `docker image inspect ${executorImage} --format '{{.Id}}'`);
      const id = pinned.stdout.trim();

      const answer = await get(env.clients[1], `/apps/fileoperationimage/${id}`);

      expect(answer.status).to.equal(403);
    });
  });
});
