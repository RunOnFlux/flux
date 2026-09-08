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

// What the node holds of one line before it cuts it: `MAX_LINE_LENGTH` in
// logFrameDecoder.js. Written out rather than imported - the runner is its own
// package and reaching into ZelBack for a number would make this suite depend on
// the node's module layout instead of on its behaviour.
const NODE_MAX_LINE_LENGTH = 1024 * 1024;

// Comfortably past it, and not a round multiple of anything docker frames with,
// so a count that came from the framing rather than from the line would not
// happen to match.
const BLOB_BYTES = 1_300_003;

describe('an app log stream loses nothing and is shared between viewers', function () {
  let env;
  dumpLogsOnFailure(() => env);

  const appName = `e2elogstream${Date.now()}`;
  const component = `${appName}a`;
  const identifier = `${component}_${appName}`;
  // A second component, because one connection following several containers is
  // part of the contract and a single-component app cannot exercise it.
  const secondComponent = `${appName}b`;
  const secondIdentifier = `${secondComponent}_${appName}`;
  // A third, which writes the line no reader can hold. Its own container because
  // every other test here watches one whose entire output is its numbered lines,
  // and a megabyte arriving every few seconds is not that.
  const blobComponent = `${appName}c`;
  const blobIdentifier = `${blobComponent}_${appName}`;
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
      truncated: [],
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
    socket.on('truncated', (payload) => viewer.truncated.push(payload));
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
      compose: [component, secondComponent, blobComponent].map((name) => ({
        name,
        description: 'writes numbered log lines on an interval',
        repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
        ports: [],
        domains: [''],
        // Only the third writes the unholdable line, and it writes it between
        // numbered ones so a reader that gave up on it can be shown not to have
        // given up on them.
        environmentParameters: name === blobComponent
          ? ['LOG_EVERY_MS=100', `LOG_BLOB_BYTES=${BLOB_BYTES}`, 'LOG_BLOB_AFTER=30']
          : ['LOG_EVERY_MS=100'],
        commands: [],
        containerPorts: [80],
        containerData: '/tmp',
        cpu: 0.1,
        ram: 100,
        hdd: 1,
        repoauth: '',
      })),
    });

    await installOnNodes(env, app, [0]);
    await waitFor(
      async () => {
        const containers = await listAppContainers(holder.container, { all: true });
        return [identifier, secondIdentifier, blobIdentifier].every(
          (name) => containers.find((c) => c.name === `flux${name}`)?.status?.startsWith('Up'),
        );
      },
      { timeout: 240000, interval: 2000, label: 'every log-writing component is running' },
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

  it('delivers every line exactly once over a run of the container', async function () {
    this.timeout(120000);

    const viewer = watch();
    await viewer.ready;

    // Long enough that many batch windows pass and the container's own writes
    // straddle several of them - a gap or a repeat has somewhere to happen.
    await new Promise((resolve) => { setTimeout(resolve, 15000); });
    const window = viewer.lines.map(lineNumber).filter((n) => n !== null);

    // The container alternates stdout and stderr and docker merges the two as it
    // reads them, so a line can reach the stream behind the one that follows it -
    // the property this fixture exists to produce. What is asserted is the window
    // above, closed by what arrives after it, so the last line of a snapshot is
    // never read as the end of the container's output.
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
    const seen = viewer.lines.map(lineNumber).filter((n) => n !== null);

    expect(window.length, 'the stream delivered nothing to reason about').to.be.above(20);
    expect(viewer.skipped, 'a keeping-up viewer was told it skipped lines').to.be.empty;

    expect(
      new Set(seen).size,
      `a line was delivered twice: ${seen.slice(0, 40).join(',')}`,
    ).to.equal(seen.length);

    // Complete, not in the container's order: the order the lines arrive in is
    // docker's merge of the two streams, which nothing downstream of it can undo.
    const closed = [...seen].sort((a, b) => a - b).filter((n) => n <= Math.max(...window));
    for (let i = 1; i < closed.length; i += 1) {
      expect(
        closed[i],
        `a gap between ${closed[i - 1]} and ${closed[i]}`,
      ).to.equal(closed[i - 1] + 1);
    }

    // The framing test: a decoder that desynchronised on a chunk boundary
    // produces garbage rather than numbered lines, so a run this long with
    // every line parsing is what says the frames were read correctly.
    expect(
      viewer.lines.filter((line) => lineNumber(line) === null),
      'lines arrived that are not the container\'s own numbered output',
    ).to.be.empty;

    viewer.close();
  });

  it('cuts a line it cannot hold, says how much it cut, and keeps the rest of the log', async function () {
    this.timeout(180000);

    // A reader holds a line until its newline arrives and nothing obliges a
    // container to send one, so an unbounded reader is a container deciding how
    // much of the node's memory a viewer costs - and then how much crosses the
    // socket, because a line that completes is delivered whole. This is that
    // container: one line of BLOB_BYTES, no newline in it, every three seconds.
    //
    // A unit test cuts a line the author framed. This is docker framing it - the
    // blob crosses eighty of docker's own 16KB frames, and what the reader is
    // given back has to be one line of them and not eighty.
    const viewer = watch(blobIdentifier);
    await viewer.ready;

    await waitFor(
      async () => viewer.truncated.length > 0,
      { timeout: 60000, interval: 500, label: 'a line too long to hold was cut' },
    );

    const cut = viewer.lines.find((line) => line.length === NODE_MAX_LINE_LENGTH);
    const longest = viewer.lines.reduce((max, line) => Math.max(max, line.length), 0);
    expect(longest, 'a line past what the node holds crossed the socket').to.equal(NODE_MAX_LINE_LENGTH);

    // One line of the container's, not eighty of docker's. Docker splits a
    // message this long across its own 16KB frames, and a stamp inside the body
    // would say each frame came back as a message of its own - which is the
    // belief a crafted buffer cannot test and this can.
    expect(cut, 'the cut line is not one the container wrote').to.match(/^\S+Z B+$/);

    // What one cut line costs: the blob, plus the ONE stamp docker gave the
    // message. The stamp's length is read off the line rather than assumed, and
    // the copies of it docker puts on every 16KB chunk after the first are not
    // part of what the container wrote and are not counted as cut from it.
    const perLine = (cut.indexOf(' ') + 1) + BLOB_BYTES - NODE_MAX_LINE_LENGTH;

    // A whole number of cut lines per notice, and never a part of one. The count
    // settles when a line ends, and the batch that follows carries whatever
    // settled during it - which is more than one line at a subscribe, because
    // the backfill is 200 of docker's ENTRIES and a line this long is eighty of
    // them. What must never appear is a remainder: that would be a stamp
    // counted as content, or a line counted twice, or a line reported in
    // instalments while its tail was still arriving.
    expect(viewer.truncated, 'nothing was reported as cut').to.not.be.empty;
    viewer.truncated.forEach((notice) => {
      expect(notice.container, 'a notice that does not name its container cannot be attributed')
        .to.equal(viewer.subscribed.container);
      expect(notice.characters % perLine, `${notice.characters} is not a whole number of cut lines of ${perLine}`)
        .to.equal(0);
      expect(notice.characters, 'a notice reported nothing').to.be.at.least(perLine);
    });

    // And the numbered lines carry on across it: a reader that gave up on the
    // blob must not give up on what followed it. The window is closed by what
    // arrives after it, for the reason the single-viewer run gives.
    const window = viewer.lines.map(lineNumber).filter((n) => n !== null);
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
    const seen = viewer.lines.map(lineNumber).filter((n) => n !== null);

    expect(window.length, 'nothing numbered arrived beside the blob').to.be.above(20);
    expect(new Set(seen).size, `a line was delivered twice: ${seen.slice(0, 40).join(',')}`).to.equal(seen.length);

    const closed = [...seen].sort((a, b) => a - b).filter((n) => n <= Math.max(...window));
    for (let i = 1; i < closed.length; i += 1) {
      expect(
        closed[i],
        `a gap between ${closed[i - 1]} and ${closed[i]} - the cut line took the log with it`,
      ).to.equal(closed[i - 1] + 1);
    }

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
    const bWindow = b.lines.map(lineNumber).filter((n) => n !== null);

    // Closed by what arrives after it, for the reason the single-viewer run gives:
    // docker's merge of the two streams can put a line behind its successor, and
    // the end of a snapshot is not the end of the container's output.
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
    const aSeen = a.lines.map(lineNumber).filter((n) => n !== null);
    const bSeen = b.lines.map(lineNumber).filter((n) => n !== null);
    expect(aSeen, 'the first viewer saw nothing').to.not.be.empty;
    expect(bWindow, 'the second viewer saw nothing').to.not.be.empty;

    // The late viewer's own sequence is the assertion that matters: it is served
    // backfill AND the live room, and any line appearing in both arrives twice.
    expect(
      new Set(bSeen).size,
      `the late viewer was told lines twice: ${bSeen.slice(0, 40).join(',')}`,
    ).to.equal(bSeen.length);
    const bClosed = [...bSeen].sort((x, y) => x - y).filter((n) => n <= Math.max(...bWindow));
    for (let i = 1; i < bClosed.length; i += 1) {
      expect(
        bClosed[i],
        `the late viewer has a gap between ${bClosed[i - 1]} and ${bClosed[i]}`,
      ).to.equal(bClosed[i - 1] + 1);
    }

    // And where the two viewers' ranges overlap they must agree exactly - the same
    // lines in the same order, because one docker stream feeds both.
    const lo = Math.max(Math.min(...aSeen), Math.min(...bSeen));
    const hi = Math.min(Math.max(...aSeen), Math.max(...bSeen));
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

  it('stops feeding a viewer that unsubscribes without disconnecting', async function () {
    this.timeout(120000);

    // A second viewer holds the feed open for the whole test, which is what
    // makes this an assertion about the leaver rather than about the stream:
    // with the feed closed, nothing would arrive at either of them and the
    // expectation below would pass without proving anything.
    //
    // Releasing the feed is only half of a subscription. The socket.io room is
    // what carries lines to a connection, and a viewer that keeps its room
    // after unsubscribing goes on being fed a container it stopped watching -
    // and is free to follow a second container while it happens.
    const keeper = watch();
    await keeper.ready;
    const leaver = watch();
    await leaver.ready;
    await new Promise((resolve) => { setTimeout(resolve, 3000); });

    expect(leaver.lines, 'the leaver was never being fed, so leaving proves nothing').to.not.be.empty;
    leaver.socket.emit('unsubscribe');
    await new Promise((resolve) => { setTimeout(resolve, 1500); });
    const settled = leaver.lines.length;

    const keeperMark = keeper.lines.length;
    await waitFor(
      async () => keeper.lines.length > keeperMark + 10,
      { timeout: 30000, interval: 500, label: 'the container is still writing and the keeper still being fed' },
    );

    expect(leaver.lines.length, 'an unsubscribed viewer is still being sent the container').to.equal(settled);
    expect(leaver.ended, 'unsubscribing is not the container stopping').to.be.false;
    keeper.close();
    leaver.close();
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

  it('takes both containers when two subscribes arrive together, and strands no stream', async function () {
    this.timeout(120000);

    // Both emitted before either can be answered, which the `watch` helper
    // cannot do: it subscribes once and waits. Two panes on one connection
    // produce exactly this, and the daemon's round trip is the window a claim
    // taken after the lookup would be passed through by both.
    const socket = io(`${holder.url}/applogs`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
    });
    const subscribed = [];
    const errors = [];
    const byContainer = new Map();
    socket.on('subscribed', (payload) => subscribed.push(payload.container));
    socket.on('error', (message) => errors.push(message));
    socket.on('logs', (payload) => {
      const seen = byContainer.get(payload.container) || [];
      seen.push(...payload.lines);
      byContainer.set(payload.container, seen);
    });

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('applogs: never connected')), CONNECT_TIMEOUT_MS);
        socket.on('connect', () => { clearTimeout(timer); resolve(); });
        socket.on('connect_error', (err) => {
          clearTimeout(timer);
          reject(new Error(`applogs: connect_error ${err.message}`));
        });
      });

      socket.emit('subscribe', auth.zelidauth, identifier);
      socket.emit('subscribe', auth.zelidauth, secondIdentifier);

      await waitFor(
        async () => subscribed.length + errors.length >= 2,
        { timeout: 30000, interval: 200, label: 'the node answered both subscribes' },
      );

      expect(errors, 'a second container on one connection was refused').to.be.empty;
      expect(subscribed, 'one connection was not given both containers').to.have.length(2);
      expect(new Set(subscribed).size, 'the same container was answered twice').to.equal(2);

      // Both are fed, and each message says which container it carries - a
      // batch that does not is unreadable to a connection following two.
      await waitFor(
        async () => byContainer.size === 2 && [...byContainer.values()].every((lines) => lines.length > 5),
        { timeout: 30000, interval: 500, label: 'both containers are reaching the connection' },
      );
      expect([...byContainer.keys()].sort(), 'lines arrived attributed to something else').to.deep.equal(subscribed.slice().sort());

      // Given up by name rather than by disconnecting, so the other one is
      // proved to survive it.
      const kept = byContainer.get(subscribed[0]).length;
      socket.emit('unsubscribe', secondIdentifier);
      await new Promise((resolve) => { setTimeout(resolve, 1500); });
      const leftSettled = byContainer.get(subscribed[1]).length;

      await waitFor(
        async () => byContainer.get(subscribed[0]).length > kept + 5,
        { timeout: 30000, interval: 500, label: 'the container that was kept is still being fed' },
      );
      expect(
        byContainer.get(subscribed[1]).length,
        'a container given up by name is still being sent',
      ).to.equal(leftSettled);
    } finally {
      socket.close();
    }
  });

  it('lets a viewer back on a container another viewer has already reopened', async function () {
    this.timeout(180000);

    // Both are watching when the container stops, so both hold a subscription
    // naming it. The one that asks again second finds the id filed to a feed
    // that is not the one it was following.
    const first = watch();
    await first.ready;
    const second = watch();
    await second.ready;

    await holder.getAuthed(`/apps/appstop/${identifier}`, auth.zelidauth);
    await waitFor(
      async () => first.ended && second.ended,
      { timeout: 60000, interval: 1000, label: 'both viewers were told the container stopped' },
    );
    await holder.getAuthed(`/apps/appstart/${identifier}`, auth.zelidauth);
    await waitFor(
      async () => {
        const containers = await listAppContainers(holder.container, { all: true });
        return containers.find((c) => c.name === `flux${identifier}`)?.status?.startsWith('Up');
      },
      { timeout: 120000, interval: 2000, label: 'the container is running again' },
    );

    // The reopen and the retry go in that order on purpose: the second viewer
    // is the one that files a new feed under the id the first one is still
    // holding.
    const reopened = [];
    second.socket.on('subscribed', (payload) => reopened.push(payload.container));
    second.socket.emit('subscribe', auth.zelidauth, identifier);
    await waitFor(
      async () => reopened.length === 1,
      { timeout: 30000, interval: 200, label: 'the other viewer reopened the container' },
    );

    const answers = [];
    first.socket.on('subscribed', (payload) => answers.push(payload.container));
    first.errors.length = 0;
    first.socket.emit('subscribe', auth.zelidauth, identifier);

    await waitFor(
      async () => answers.length + first.errors.length >= 1,
      { timeout: 30000, interval: 200, label: 'the node answered the viewer that came back' },
    );

    expect(first.errors, 'the viewer was locked out for the life of its connection').to.be.empty;
    expect(answers, 'the viewer was not given the container back').to.have.length(1);

    const mark = first.lines.length;
    await waitFor(
      async () => first.lines.length > mark,
      { timeout: 30000, interval: 500, label: 'the viewer that came back is being fed again' },
    );

    first.close();
    second.close();
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
