// weight: medium
/*
 * /applogs, against a container that is genuinely writing logs.
 *
 * Suite 59 proves the POLL loses nothing. This proves the same thing for the
 * push, and the two are not the same claim: a poll reconstructs the reader's
 * place from a timestamp on every request, and a stream never does - docker is
 * followed once and every line is forwarded as it is written. So the failure
 * modes are different ones, and none of them are visible to a unit test:
 *
 * FRAMING. A follow stream is chunked wherever TCP put the boundary, not on
 * docker's frame edges. A decoder that assumes whole frames reads a length out
 * of half a header and desynchronises for the rest of the container's life.
 * A crafted buffer in a unit test is the author's belief about where docker
 * splits; this is docker splitting.
 *
 * FAN-OUT. One docker stream serves every viewer of a container, so the stream
 * outlives the connection that opened it and is owned by none of them. Whether
 * the last viewer leaving actually stops the daemon is a property of a real
 * daemon and a real disconnect.
 *
 * ORDER AND COMPLETENESS. The container numbers its own lines, which is what
 * makes a gap and a repeat both visible. The writer alternates stdout and
 * stderr, so the two framed streams interleave in one connection - the case a
 * stdout-only writer cannot produce.
 */
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { io } from 'socket.io-client';
import { createTestEnv } from '../framework/test-env.js';
import { pushTestApp } from '../framework/registry-helper.js';
import { buildSeedableApp } from '../framework/seed-helper.js';
import { REGISTRY_REPO_HOST } from '../framework/subnet-config.js';
import { listAppContainers } from '../framework/container.js';
import { waitFor } from '../framework/wait.js';
import { bootAndPeer, installOnNodes } from '../framework/reconciler-suite.js';
import { authenticate } from '../auth.js';
import { appOwnerKey } from '../framework/keys.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const CONNECT_TIMEOUT_MS = 20000;

describe('an app log stream loses nothing and is shared between viewers', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2elogstream${Date.now()}`;
  const component = `${appName}a`;
  const identifier = `${component}_${appName}`;
  let holder;
  let auth;

  const lineNumber = (line) => {
    const match = /log line (\d+)\s*$/.exec(line);
    return match ? Number(match[1]) : null;
  };

  /**
   * A viewer. Collects every line and every control message it is sent, so a
   * test asserts on what actually arrived rather than on a single event.
   */
  function watch(nameOrId = identifier, zelidauth = auth.zelidauth) {
    const socket = io(`${holder.url}/applogs`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
    });
    const viewer = {
      socket,
      lines: [],
      frames: 0,
      skipped: [],
      errors: [],
      ended: false,
      subscribed: null,
      close() { socket.close(); },
    };

    socket.on('logs', (payload) => {
      viewer.frames += 1;
      viewer.lines.push(...payload.lines);
    });
    socket.on('skipped', (payload) => viewer.skipped.push(payload));
    socket.on('error', (message) => viewer.errors.push(message));
    socket.on('ended', () => { viewer.ended = true; });

    viewer.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('applogs: no answer to subscribe')), CONNECT_TIMEOUT_MS);
      socket.on('subscribed', (payload) => {
        clearTimeout(timer);
        viewer.subscribed = payload;
        resolve(payload);
      });
      socket.on('error', (message) => {
        clearTimeout(timer);
        reject(new Error(`applogs: ${message}`));
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(new Error(`applogs: connect_error ${err.message}`));
      });
      socket.on('connect', () => socket.emit('subscribe', zelidauth, nameOrId));
    });

    return viewer;
  }

  before(async function () {
    this.timeout(420000);

    env = await createTestEnv({ hookCtx: this, nodes: 3, tickerAutostart: false });
    await bootAndPeer(env);
    [holder] = env.clients;

    await pushTestApp(appName, 'v1');
    const app = await buildSeedableApp({
      env,
      name: appName,
      compose: [{
        name: component,
        description: 'writes numbered log lines on an interval',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        environmentParameters: ['LOG_EVERY_MS=100'],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      }],
    });

    await installOnNodes(env, app, [0]);
    await waitFor(
      async () => {
        const containers = await listAppContainers(holder.container, { all: true });
        return containers.find((c) => c.name === `flux${identifier}`)?.status?.startsWith('Up');
      },
      { timeout: 120000, interval: 2000, label: 'the log-writing component is running' },
    );

    auth = await authenticate(holder.url, appOwnerKey());
  });

  after(async function () {
    this.timeout(60000);
    await env?.teardown();
  });

  it('refuses a viewer that is not the app owner, without opening a stream', async function () {
    this.timeout(60000);

    const viewer = watch(identifier, 'zelid=nobody&signature=nonsense&loginPhrase=nonsense');
    const outcome = await viewer.ready.then(() => null, (err) => err);
    expect(outcome, 'an unauthorised viewer was subscribed').to.be.an('error');
    expect(outcome.message).to.match(/Not authorized/);
    viewer.close();
  });

  it('answers a container that is not there rather than hanging', async function () {
    this.timeout(60000);

    const viewer = watch('fluxnosuch_nosuchapp');
    const outcome = await viewer.ready.then(() => null, (err) => err);
    expect(outcome, 'a missing container left the viewer waiting').to.be.an('error');
    viewer.close();
  });

  it('backfills on subscribe, so a viewer opens with context', async function () {
    this.timeout(90000);

    const viewer = watch();
    await viewer.ready;
    await waitFor(
      async () => viewer.lines.some((line) => lineNumber(line) !== null),
      { timeout: 30000, interval: 500, label: 'the stream delivered lines' },
    );

    expect(viewer.lines.map(lineNumber).filter((n) => n !== null), 'an empty pane until the container next writes').to.not.be.empty;
    viewer.close();
  });

  it('delivers every line exactly once, in order, over a run of the container', async function () {
    this.timeout(120000);

    const viewer = watch();
    await viewer.ready;

    // Long enough that many batch windows pass and the container's own writes
    // straddle several of them - a gap or a repeat has somewhere to happen.
    await new Promise((resolve) => { setTimeout(resolve, 15000); });

    const seen = viewer.lines.map(lineNumber).filter((n) => n !== null);
    expect(seen.length, 'the stream delivered nothing to reason about').to.be.above(20);
    expect(viewer.skipped, 'a keeping-up viewer was told it skipped lines').to.be.empty;

    const contiguous = seen.every((n, i) => i === 0 || n === seen[i - 1] + 1);
    expect(
      contiguous,
      `the sequence has a gap or a repeat: ${seen.slice(0, 40).join(',')}`,
    ).to.be.true;

    // The framing test: a decoder that desynchronised on a chunk boundary
    // produces garbage rather than numbered lines, so a run this long with
    // every line parsing is what says the frames were read correctly.
    expect(
      viewer.lines.filter((line) => lineNumber(line) === null),
      'lines arrived that are not the container\'s own numbered output',
    ).to.be.empty;

    viewer.close();
  });

  it('batches, so a chatty container does not cost a message per line', async function () {
    this.timeout(90000);

    const viewer = watch();
    await viewer.ready;
    await new Promise((resolve) => { setTimeout(resolve, 10000); });

    const lines = viewer.lines.map(lineNumber).filter((n) => n !== null).length;
    expect(lines, 'nothing arrived').to.be.above(20);
    // The container writes every 100ms and the window is 250ms, so several
    // lines share a frame. A message per line is the regression.
    expect(
      viewer.frames,
      `${lines} lines arrived in ${viewer.frames} frames - batching is not happening`,
    ).to.be.below(lines);

    viewer.close();
  });

  it('serves two viewers from one docker stream, and both see the same lines', async function () {
    this.timeout(120000);

    const a = watch();
    await a.ready;
    const b = watch();
    await b.ready;

    await new Promise((resolve) => { setTimeout(resolve, 10000); });

    const aSeen = a.lines.map(lineNumber).filter((n) => n !== null);
    const bSeen = b.lines.map(lineNumber).filter((n) => n !== null);
    expect(aSeen, 'the first viewer saw nothing').to.not.be.empty;
    expect(bSeen, 'the second viewer saw nothing').to.not.be.empty;

    // The late viewer's own sequence is the assertion that matters: it is served
    // backfill AND the live room, and any line appearing in both arrives twice.
    const bContiguous = bSeen.every((n, i) => i === 0 || n === bSeen[i - 1] + 1);
    expect(
      bContiguous,
      `the late viewer was told lines twice or out of order: ${bSeen.slice(0, 40).join(',')}`,
    ).to.be.true;

    // And where the two viewers' ranges overlap they must agree exactly.
    const lo = Math.max(aSeen[0], bSeen[0]);
    const hi = Math.min(aSeen[aSeen.length - 1], bSeen[bSeen.length - 1]);
    const inRange = (ns) => ns.filter((n) => n >= lo && n <= hi);
    expect(hi, 'the two viewers never overlapped, so nothing was compared').to.be.above(lo);
    expect(
      inRange(aSeen),
      'two viewers of one container were told different things',
    ).to.deep.equal(inRange(bSeen));

    a.close();
    b.close();
  });

  it('keeps the stream for the remaining viewer when one leaves', async function () {
    this.timeout(120000);

    const a = watch();
    await a.ready;
    const b = watch();
    await b.ready;
    await new Promise((resolve) => { setTimeout(resolve, 3000); });

    a.close();
    const mark = b.lines.map(lineNumber).filter((n) => n !== null).length;

    await waitFor(
      async () => b.lines.map(lineNumber).filter((n) => n !== null).length > mark + 10,
      { timeout: 30000, interval: 500, label: 'the remaining viewer is still being fed' },
    );

    expect(b.errors, 'the remaining viewer was told the stream failed').to.be.empty;
    b.close();
  });

  it('tells a viewer when the container stops', async function () {
    this.timeout(120000);

    const viewer = watch();
    await viewer.ready;
    await new Promise((resolve) => { setTimeout(resolve, 2000); });

    await holder.getAuthed(`/apps/appstop/${identifier}`, auth.zelidauth);

    await waitFor(
      async () => viewer.ended,
      { timeout: 60000, interval: 1000, label: 'the viewer was told the container stopped' },
    );

    expect(viewer.ended, 'a pane that stops updating silently looks like a bug').to.be.true;
    viewer.close();

    await holder.getAuthed(`/apps/appstart/${identifier}`, auth.zelidauth);
  });

  it('leaves the polling endpoint answering exactly as it did', async function () {
    this.timeout(90000);

    // The mixed-fleet guarantee. The network runs several FluxOS versions at
    // once and always will, so a viewer must be able to fall back to the poll
    // against a node that has no /applogs - and this node must still answer it.
    await waitFor(
      async () => {
        const body = await holder.getAuthed(`/apps/applogpolling/${identifier}/100`, auth.zelidauth);
        return body.status === 'success' && body.logs.length > 0;
      },
      { timeout: 60000, interval: 1000, label: 'the polling endpoint still answers' },
    );

    const body = await holder.getAuthed(`/apps/applogpolling/${identifier}/100`, auth.zelidauth);
    expect(body.cursor, 'the poll stopped handing back a position').to.be.a('string');
    expect(body.skipped, 'a first-time reader was told it skipped lines').to.not.be.true;
  });
});
