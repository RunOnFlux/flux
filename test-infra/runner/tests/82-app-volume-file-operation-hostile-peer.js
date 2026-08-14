import { describe, it, before, beforeEach, after } from 'mocha';
import { expect } from 'chai';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer, restartFluxos } from '../framework/container.js';
import {
  pushImage, mirrorExecutorImage, executorImageReference, executorAcceptedIds,
} from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { waitFor, waitForOperation, waitForNetworkStateSize } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { REGISTRY_REPO_HOST, getSubnetConfig } from '../framework/subnet-config.js';
import { setNodeList } from '../framework/daemon-control.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import {
  volumeRoot, resetVolume, seedVolumeTree, exists,
} from '../framework/volume-fixture.js';

// What a node accepts from another node that is lying to it.
//
// Suite 81 proves the image really moves between nodes. This one proves the
// receiving node survives a peer that does not play fair - which nothing else
// exercises, because every peer in every other suite is a real FluxOS node
// behaving correctly. The archive is the one thing a node takes from another
// node and then RUNS, so what it refuses matters more than what it accepts.
//
// The rogue peer is served by the runner rather than by a container: the docker
// bridge gateway IS the host, so a node reaching the gateway address reaches
// this process, and misbehaviour is then a few lines of JavaScript rather than
// a stub image to build and keep in step.

const here = dirname(fileURLToPath(import.meta.url));
const deterministicList = JSON.parse(
  readFileSync(join(here, '..', '..', 'fixtures', 'deterministic-list.json'), 'utf-8'),
);

describe('app volume file operations - a peer that does not play fair', function () {
  let env;
  let auth;
  let executorImage;
  let rogue;
  let rogueUrl;
  let behaviour = null;
  const openResponses = new Set();
  dumpLogsOnFailure(() => env);

  const subnet = getSubnetConfig();
  const ts = Date.now();
  const appName = `e2efilehostile${ts}`;
  const root = volumeRoot(appName);
  const NODES = 3;

  const post = (node, path, body) => node.request('POST', path, { body, headers: { zelidauth: auth.zelidauth } });
  const inNode = (index, command) => execInContainer(env.clients[index].container, command);

  async function acceptedIdsFor(index) {
    const arch = (await inNode(index, 'docker version --format "{{.Server.Arch}}"')).stdout.trim();
    return executorAcceptedIds(arch);
  }

  async function imageHeldOn(index) {
    for (const id of await acceptedIdsFor(index)) {
      const r = await inNode(index, `docker image inspect ${id} >/dev/null 2>&1; echo $?`);
      if (r.stdout.trim() === '0') return true;
    }
    return false;
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

  async function heldIdOn(index) {
    for (const id of await acceptedIdsFor(index)) {
      const r = await inNode(index, `docker image inspect ${id} >/dev/null 2>&1; echo $?`);
      if (r.stdout.trim() === '0') return id;
    }
    return null;
  }

  async function forgetImageOn(index) {
    for (const id of await acceptedIdsFor(index)) {
      await inNode(index, `docker rmi -f ${id} >/dev/null 2>&1 || true`);
    }
  }

  /**
   * A tar, written out here rather than taken from a library.
   *
   * The runner does not depend on one, and a hostile archive is the wrong thing
   * to build with a helper that only knows how to make correct ones. Checked
   * against both node-tar and GNU tar before it was relied on.
   */
  function tarOf(files) {
    const blocks = [];
    for (const [name, body] of Object.entries(files)) {
      const data = Buffer.from(body);
      const header = Buffer.alloc(512);
      header.write(name, 0, 100, 'utf8');
      header.write('000644 \0', 100, 8);
      header.write('000000 \0', 108, 8);
      header.write('000000 \0', 116, 8);
      header.write(`${data.length.toString(8).padStart(11, '0')} `, 124, 12);
      header.write(`${(0).toString(8).padStart(11, '0')} `, 136, 12);
      header.write('        ', 148, 8);
      header.write('0', 156, 1);
      header.write('ustar\0', 257, 6);
      header.write('00', 263, 2);
      let sum = 0;
      for (const byte of header) sum += byte;
      header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
      blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    return Buffer.concat(blocks);
  }

  /** A docker image archive whose manifest declares the given names. */
  const archiveDeclaring = (names) => tarOf({
    'manifest.json': JSON.stringify([{ Config: 'config.json', RepoTags: names, Layers: ['layer.tar'] }]),
    'config.json': '{}',
    'layer.tar': 'not really a layer',
  });

  before(async function () {
    this.timeout(600000);
    executorImage = executorImageReference();

    // Answers the image endpoint however the test in hand tells it to. Bound on
    // every interface so the containers reach it through the bridge gateway.
    rogue = createServer((req, res) => {
      // Held so they can be taken down at the end: several of these tests
      // deliberately leave a response open, and server.close() waits for every
      // connection to end - so without this the suite's own teardown hangs on
      // the sockets it was written to leave hanging.
      openResponses.add(res);
      res.on('close', () => openResponses.delete(res));
      if (!behaviour) {
        res.statusCode = 404;
        res.end();
        return;
      }
      behaviour(req, res);
    });
    await new Promise((resolve) => { rogue.listen(0, '0.0.0.0', resolve); });
    rogueUrl = `${subnet.gateway}:${rogue.address().port}`;

    env = await createTestEnv({
      hookCtx: this,
      nodes: NODES,
      tickerAutostart: false,
      configOverrides: {
        fluxapps: {
          minOutgoing: 1,
          minIncoming: 1,
          volumeOperations: {
            image: executorImage,
            // Far enough out that no node reaches its own registry slot during
            // the suite: what is watched here is what a fetch does with what a
            // peer sends, not the background one racing it.
            prefetchWindowMs: 24 * 60 * 60 * 1000,
          },
        },
      },
    });
    await mirrorExecutorImage();
    await bootAndPeer(env, { minOutbound: 1, minInbound: 1 });

    // A fourth entry, fully formed from the same fixture the real ones come
    // from, whose address is this process. The nodes will now draw it when they
    // look for a peer holding the image.
    //
    // Anchored before the change and then waited on: the node's view of the
    // fleet is a cache refreshed on a timer, so setting the list proves only
    // that the daemon knows - and a test that started asking before this node
    // had read it would fail for a reason that is not the product.
    const anchor = env.clients[0].getLastEventId();
    const withRogue = deterministicList.slice(0, NODES + 1).map((entry, index) => ({
      ...entry,
      ip: index < NODES ? subnet.nodeIp(index + 1) : rogueUrl,
    }));
    await setNodeList(withRogue);
    await waitForNetworkStateSize(env.clients[0], NODES + 1, 120000, { afterId: anchor });

    await pushImage(appName, 'v1');
    const app = await buildSeedableApp({
      name: appName,
      compose: [{
        name: appName,
        description: 'a peer that does not play fair',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [31821],
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
    behaviour = null;
    openResponses.forEach((res) => res.destroy());
    openResponses.clear();
    if (rogue) {
      rogue.closeAllConnections();
      await new Promise((resolve) => rogue.close(resolve));
    }
    await env?.teardown();
  });

  beforeEach(async function () {
    this.timeout(120000);
    behaviour = null;
    openResponses.forEach((res) => res.destroy());
    openResponses.clear();
    await restoreRegistry(0);
    await forgetImageOn(0);
    await resetVolume(env.clients[0].container, appName);
    await seedVolumeTree(env.clients[0].container, appName, { 'photos/a.txt': 'first' });
  });

  /**
   * Run an operation and answer what happened, without asserting: these tests
   * are about the node still working afterwards, and the operation is the way
   * to ask.
   */
  async function copyObjectOnce(timeout = 240000) {
    const accepted = await post(env.clients[0], '/apps/copyobject', {
      appname: appName, component: appName, source: 'photos', destination: `copied-${Date.now()}`,
    });
    if (accepted.status !== 202) return { accepted, job: null };
    const job = await waitForOperation(env.clients[0], accepted.data.data.jobId, auth.zelidauth, { timeout });
    return { accepted, job };
  }

  /** Whether an answer is the node saying "not yet, come back". */
  const comeBackLater = ({ accepted, job }) => accepted.status === 503
    || (job && job.status === 'Failed' && /is being fetched/.test(JSON.stringify(job.error)));

  /**
   * Ask, and come back when the node says to.
   *
   * A test before this one will have made an acquisition genuinely fail, and a
   * node that has just failed refuses every caller for a silence window rather
   * than repeating the whole search per click. That is deliberate, so a single
   * request afterwards is not a fair question - and taking its refusal for a
   * result made five tests here fail for the product working correctly.
   *
   * Bounded, because "eventually" is not an assertion: if the node never comes
   * back this returns the last refusal and the caller asserts on it.
   */
  async function copyObject(timeout = 240000) {
    const deadline = Date.now() + 180000;
    let answer = await copyObjectOnce(timeout);
    while (comeBackLater(answer) && Date.now() < deadline) {
      await new Promise((resolve) => { setTimeout(resolve, 10000); });
      answer = await copyObjectOnce(timeout);
    }
    return answer;
  }

  /** Where this node answers the image endpoint. */
  function imageEndpoint(index, id) {
    const { hostname, port } = new URL(env.clients[index].url);
    return { hostname, port: Number(port), path: `/apps/fileoperationimage/${id}` };
  }

  /**
   * A caller that completes its request and then reads nothing at all.
   *
   * A raw socket rather than an http client, because every client reads the
   * response for you - and not reading it is the whole point. This is what an
   * application container anywhere on the fleet can do, since its traffic
   * leaves under its host node's address.
   *
   * Resolves once the request is on the wire, not when connect() returns. A
   * caller that has not sent anything yet is holding no slot, so a probe made
   * between opening one and it arriving finds the ceiling unreached - the loop
   * below outran twelve of these and then watched them all get refused after it
   * had given up.
   */
  function connectAndIgnore({ hostname, port, path }) {
    return new Promise((resolve, reject) => {
      const socket = connect(port, hostname);

      socket.on('error', reject);
      socket.on('connect', () => {
        socket.write(`GET ${path} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: keep-alive\r\n\r\n`, () => {
          socket.pause();
          socket.removeListener('error', reject);
          socket.on('error', () => {});
          resolve(socket);
        });
      });
    });
  }

  function statusOf({ hostname, port, path }, method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ hostname, port, path, method }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('answers HEAD without packing an archive', async function () {
    this.timeout(420000);
    // Express answers HEAD from the GET route, and node throws away a HEAD body
    // without ever applying backpressure - so a HEAD bought a full export, read
    // off the disk and packed by docker, for one packet and no bandwidth.
    const { job } = await copyObject();
    expect(job.status, JSON.stringify(job && job.error)).to.equal('Succeeded');
    const id = await heldIdOn(0);
    expect(id, 'FIXTURE: node 0 does not hold the image to serve').to.not.equal(null);

    expect(await statusOf(imageEndpoint(0, id), 'HEAD')).to.equal(405);
    // And the ordinary request still works, so 405 is about the method and not
    // about this node having stopped serving.
    expect(await statusOf(imageEndpoint(0, id), 'GET')).to.equal(200);
  });

  it('takes back a slot from callers that never read, and serves again', async function () {
    this.timeout(420000);
    // A slot came back only when the caller DISCONNECTED, and a caller that
    // neither disconnects nor reads does neither: the export blocks on
    // backpressure and the slot is held for as long as the socket is open. Two
    // of these took every slot on a node until FluxOS restarted, and nothing
    // said so - the node's own operations kept working, so it looked healthy
    // while serving no peer at all.
    const { job } = await copyObject();
    expect(job.status, JSON.stringify(job && job.error)).to.equal('Succeeded');
    const id = await heldIdOn(0);
    expect(id, 'FIXTURE: node 0 does not hold the image to serve').to.not.equal(null);

    const endpoint = imageEndpoint(0, id);
    const idle = [];
    let refused = null;
    // Fill it, then find the caller past the ceiling. Derived rather than
    // written down, so this stays true if the number moves - and each holder is
    // awaited onto the wire before the next probe, or the probes outrun them
    // and nothing is holding a slot when the ceiling is asked about.
    for (let i = 0; i < 12 && !refused; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const status = await Promise.race([
        statusOf(endpoint),
        new Promise((resolve) => { setTimeout(() => resolve('serving'), 3000); }),
      ]);
      if (status === 503) refused = true;
      // eslint-disable-next-line no-await-in-loop
      else idle.push(await connectAndIgnore(endpoint));
    }
    expect(refused, `the ceiling never refused anyone after ${idle.length} callers took a slot and held it`).to.equal(true);

    try {
      // The slots are held by callers taking nothing. Once the stall window has
      // passed the node should have taken them back and serve again.
      await waitFor(async () => await statusOf(endpoint) === 200, {
        timeout: 120000, interval: 5000, label: 'the node serving a peer again',
      });
    } finally {
      idle.forEach((socket) => socket.destroy());
    }
  });

  it('does not take an unbounded archive from a peer', async function () {
    this.timeout(420000);
    // Nothing is known about the bytes until they have all arrived, and they
    // used to arrive straight into the docker store - so a peer could write
    // until the disk the tenants' applications are on was full. The ceiling is
    // the only thing between a peer and that disk.
    // Bounded here so this process cannot balloon, and generously enough that
    // the node still never reaches the end of it: the node refuses at 128MiB,
    // so from where it stands the archive is as endless as an uncapped one.
    // Without a cap the generator keeps producing after the node has hung up -
    // writes to a socket the node destroyed stop pushing back, and the stub
    // does not learn it is over until 'close' is dispatched - which reached
    // 871MiB of this process's heap in a parallel gate, competing for memory
    // with every other suite's fleet on the same box.
    const offerBytes = 192 * 1024 * 1024;

    behaviour = (req, res) => {
      res.setHeader('Content-Type', 'application/x-tar');

      let offered = 0;

      const endless = new Readable({
        read() {
          if (offered >= offerBytes) {
            this.push(null);

            return;
          }
          offered += 1024 * 1024;
          this.push(Buffer.alloc(1024 * 1024));
        },
      });
      endless.pipe(res);
      res.on('close', () => endless.destroy());
    };

    const before = await inNode(0, 'df -k / | tail -1 | awk \'{print $4}\'');
    const { job } = await copyObject();

    // The registry is reachable, so the node recovers by falling through to it:
    // a peer that lies must cost the operation nothing but time.
    expect(job.status, JSON.stringify(job && job.error)).to.equal('Succeeded');
    expect(await imageHeldOn(0), 'the node did not end up with the image').to.equal(true);

    // What the peer generated is not what the node took: the two are separated
    // by the peer's own write buffer, which keeps filling after the node has
    // hung up and empties at a rate that depends on how loaded the box is.
    // Asserting on it failed a node that had cut the transfer off at its
    // ceiling on the nose. The disk below is the quantity this is about - the
    // ceiling exists to keep a peer off the disk the tenants' apps are on.
    const after = await inNode(0, 'df -k / | tail -1 | awk \'{print $4}\'');
    const lostKb = parseInt(before.stdout.trim(), 10) - parseInt(after.stdout.trim(), 10);
    expect(lostKb, `the node lost ${lostKb}KiB of disk to a peer`).to.be.lessThan(512 * 1024);
  });

  it('does not let a peer name this node\'s own images', async function () {
    this.timeout(420000);
    // docker load APPLIES the names an archive declares, taking them off
    // whatever this node had under them - so a peer packing in the name of an
    // image this node is running renames it, and removing the stolen name
    // afterwards leaves the real image nameless, which is to say dangling,
    // which is to say the next prune deletes it.
    const victim = `${REGISTRY_REPO_HOST}/${appName}:v1`;
    const idBefore = await inNode(0, `docker image inspect ${victim} --format '{{.Id}}'`);
    expect(idBefore.exitCode, 'FIXTURE: the app image is not on this node to steal').to.equal(0);

    const archive = archiveDeclaring([victim]);
    behaviour = (req, res) => {
      res.setHeader('Content-Type', 'application/x-tar');
      res.end(archive);
    };

    const { job } = await copyObject();
    expect(job.status, JSON.stringify(job && job.error)).to.equal('Succeeded');

    const idAfter = await inNode(0, `docker image inspect ${victim} --format '{{.Id}}'`);
    expect(idAfter.exitCode, 'the app image lost its name to a peer').to.equal(0);
    expect(idAfter.stdout.trim(), 'the app image name was moved onto what a peer sent')
      .to.equal(idBefore.stdout.trim());
  });

  it('gives up on a peer that answers and then goes silent', async function () {
    this.timeout(420000);
    // The one that froze a node until FluxOS restarted: the request timeout is
    // spent once the headers arrive, so the body had no bound at all and the
    // load waited on it for ever. Nothing retried, the registry was never
    // reached, and every file operation was refused for as long as the process
    // lived.
    let held = null;
    behaviour = (req, res) => {
      res.setHeader('Content-Type', 'application/x-tar');
      res.write(Buffer.from('the first chunk'));
      held = res; // and never another byte
    };

    const started = Date.now();
    const { job } = await copyObject();
    const took = Date.now() - started;

    expect(job.status, JSON.stringify(job && job.error)).to.equal('Succeeded');
    expect(took, `the operation took ${Math.round(took / 1000)}s`).to.be.lessThan(300000);
    if (held) held.destroy();

    // And the node is not wedged: the next operation works too, which is what
    // failed before - the shared round never settled, so nothing ever did.
    const second = await copyObject();
    expect(second.job.status, 'the node was left unable to run anything else').to.equal('Succeeded');
  });

  it('reaches the registry for a caller that arrives while a peer is stalling', async function () {
    this.timeout(420000);
    // The caller's round used to be whatever round was already in flight. A
    // file operation arriving during the prefetch's peers-only round inherited
    // its refusal without the registry ever being asked, and that round
    // scheduled no retry either. A stalling peer is what makes the window wide
    // enough to land in deliberately.
    behaviour = (req, res) => {
      res.setHeader('Content-Type', 'application/x-tar');
      res.write(Buffer.from('the first chunk'));
    };

    const { job } = await copyObject();

    expect(job.status, JSON.stringify(job && job.error)).to.equal('Succeeded');
    expect(await imageHeldOn(0), 'the caller never reached the registry').to.equal(true);
  });

  // LAST, deliberately. It cuts this node off from every source and restarts
  // FluxOS, so anything after it would be asking a node that has just been
  // taught it cannot get the image - which is a different question from the one
  // it meant to ask.
  it('keeps a parked entry when no source can supply the image', async function () {
    this.timeout(420000);
    // The boot sweep restores an interrupted publish by RUNNING a container, so
    // a node that cannot get the image cannot do it. What matters is which way
    // it fails: the parked entry is the owner's only copy of what was displaced,
    // and giving up must leave it exactly where it is rather than tidy it away.
    const uuid = '11111111-2222-4333-8444-999999999999';
    behaviour = (req, res) => {
      res.setHeader('Content-Type', 'application/x-tar');
      res.write(Buffer.from('the first chunk')); // and never another
    };
    await cutOffRegistry(0);

    // A publish interrupted between its two renames: the caller's previous data
    // is parked, and its own path is empty.
    await inNode(0, `mkdir -p ${root}/.flux-old-${uuid}`
      + ` && echo mine > ${root}/.flux-old-${uuid}/only-copy.txt`
      + ` && printf '%b' "photos-restored\n1 1 btime\n" > ${root}/.flux-old-${uuid}.dest`);

    await restartFluxos(env.clients[0].container);
    await waitFor(async () => (await env.clients[0].request('GET', '/flux/version')).status === 200, {
      timeout: 120000, interval: 2000, label: 'node back up',
    });

    // Long enough for the sweep to have tried every entry and given up. There
    // is no signal for "the sweep finished having done nothing", which is the
    // case under test, so this waits rather than watches.
    await new Promise((resolve) => { setTimeout(resolve, 30000); });

    expect(
      await exists(env.clients[0].container, `${root}/.flux-old-${uuid}/only-copy.txt`),
      'the only copy of the displaced data was removed by a sweep that could not place it',
    ).to.equal(true);
    expect(
      await exists(env.clients[0].container, `${root}/.flux-old-${uuid}.dest`),
      'the marker went, so nothing will ever place the entry beside it',
    ).to.equal(true);
  });
});
