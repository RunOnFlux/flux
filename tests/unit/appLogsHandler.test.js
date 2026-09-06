const chai = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('events');
const proxyquire = require('proxyquire');

const { expect } = chai;

describe('appLogsHandler tests', () => {
  let verifyPrivilege;
  let getDockerContainerByIdOrName;
  let appLogsHandler;
  let logStream;
  let container;
  let emitted;

  function frame(text, streamId = 1) {
    const body = Buffer.from(text, 'utf8');
    const header = Buffer.alloc(8);
    header.writeUInt8(streamId, 0);
    header.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, body]);
  }

  // The namespace records what each room was told, so a test asserts on the
  // fan-out rather than on one socket - and delivers by membership as well, so a
  // socket left in a room after its feed closed is caught receiving what it did
  // not ask for. socketsLeave is the only way the handler can empty a room: a
  // feed knows its room and cannot reach the connections holding it.
  const makeNamespace = () => {
    const members = new Set();
    return {
      members,
      to(room) {
        return {
          emit: (event, payload) => {
            emitted.push({ room, event, payload });
            members.forEach((member) => {
              if (member.rooms.has(room)) member.received.push({ event, payload });
            });
          },
        };
      },
      socketsLeave(room) {
        members.forEach((member) => member.leave(room));
      },
    };
  };

  const makeSocket = (id, nsp) => {
    const listeners = {};
    const socket = {
      id,
      nsp,
      connected: true,
      rooms: new Set(),
      received: [],
      emit: sinon.stub(),
      join(room) { this.rooms.add(room); },
      leave(room) { this.rooms.delete(room); },
      on(event, fn) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      fire(event, ...args) {
        return Promise.all((listeners[event] || []).map((fn) => fn(...args)));
      },
    };
    nsp.members.add(socket);
    return socket;
  };

  beforeEach(() => {
    emitted = [];
    logStream = new EventEmitter();
    logStream.destroy = sinon.stub();
    container = { id: 'abc123', logs: sinon.stub().resolves(logStream) };
    verifyPrivilege = sinon.stub().resolves(true);
    getDockerContainerByIdOrName = sinon.stub().resolves(container);
    appLogsHandler = proxyquire('../../ZelBack/src/lib/socketIoHandlers/appLogsHandler', {
      '../../services/verificationHelper': { verifyPrivilege },
      '../../services/dockerService': { getDockerContainerByIdOrName },
    });
  });

  afterEach(() => {
    appLogsHandler.feeds.forEach((feed) => clearInterval(feed.timer));
    appLogsHandler.feeds.clear();
    sinon.restore();
  });

  async function subscribe(socket, name = 'fluxcomp_myapp', auth = 'zelidauth') {
    await socket.fire('subscribe', auth, name);
  }

  // Let the listener run until it reaches the await being raced. A fixed number
  // of microtask ticks would be guessing at how many awaits precede it.
  async function until(predicate, ticks = 50) {
    for (let i = 0; i < ticks; i += 1) {
      if (predicate()) return;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => { setImmediate(resolve); });
    }
    throw new Error('condition never reached');
  }

  describe('authorisation', () => {
    it('refuses a non-string container without reaching the verifier', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await socket.fire('subscribe', 'zelidauth', { evil: true });

      expect(socket.emit.calledWith('error', 'No container specified.')).to.be.true;
      expect(verifyPrivilege.called, 'verifyPrivilege throws a TypeError for a non-string on purpose').to.be.false;
    });

    it('refuses a non-string zelidauth without reaching the verifier', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await socket.fire('subscribe', { evil: true }, 'fluxcomp_myapp');

      expect(socket.emit.calledWith('error', 'Not authorized.')).to.be.true;
      expect(verifyPrivilege.called).to.be.false;
    });

    it('does not touch docker for an unauthorised caller', async () => {
      // The lookup is a remote-controlled operation on an attacker-supplied
      // name, so it must sit behind the privilege check rather than beside it.
      verifyPrivilege.resolves(false);
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await subscribe(socket);

      expect(socket.emit.calledWith('error', 'Not authorized.')).to.be.true;
      expect(getDockerContainerByIdOrName.called).to.be.false;
    });

    it('asks for the privilege by the app name, not the component name', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await subscribe(socket, 'fluxcomponent_myapp');

      expect(verifyPrivilege.firstCall.args[2]).to.deep.equal({ appName: 'myapp' });
    });

    it('answers a container that is not there rather than opening a feed', async () => {
      getDockerContainerByIdOrName.rejects(new Error('Container nope not found'));
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await subscribe(socket, 'nope');

      expect(socket.emit.calledWith('error', 'Container not found.')).to.be.true;
      expect(appLogsHandler.feeds.size).to.equal(0);
    });
  });

  describe('the stream is shared', () => {
    it('opens one docker stream however many viewers subscribe', async () => {
      const nsp = makeNamespace();
      const a = makeSocket('s1', nsp);
      const b = makeSocket('s2', nsp);
      appLogsHandler(a); appLogsHandler(b);

      await subscribe(a);
      await subscribe(b);

      expect(container.logs.callCount, 'a stream per viewer multiplies the daemon\'s work').to.equal(1);
      expect(appLogsHandler.feeds.get('abc123').subscribers.size).to.equal(2);
    });

    it('bounds the docker read that establishes the stream', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await subscribe(socket);

      const opts = container.logs.firstCall.args[0];
      expect(opts.follow, 'a poll is not what this is').to.be.true;
      expect(opts.tail, 'follow without a tail reads the whole file to establish').to.equal(appLogsHandler.BACKFILL_LINES);
      expect(opts.timestamps).to.be.true;
    });

    it('keeps the stream while any viewer remains and closes it when the last leaves', async () => {
      const nsp = makeNamespace();
      const a = makeSocket('s1', nsp);
      const b = makeSocket('s2', nsp);
      appLogsHandler(a); appLogsHandler(b);
      await subscribe(a);
      await subscribe(b);

      await a.fire('disconnect');
      expect(logStream.destroy.called, 'one viewer leaving is not the last').to.be.false;
      expect(appLogsHandler.feeds.has('abc123')).to.be.true;

      await b.fire('disconnect');
      expect(logStream.destroy.called, 'nothing is reading what the daemon is sending').to.be.true;
      expect(appLogsHandler.feeds.has('abc123')).to.be.false;
    });

    it('releases the feed when a viewer unsubscribes without disconnecting', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);

      await socket.fire('unsubscribe');

      expect(appLogsHandler.feeds.has('abc123')).to.be.false;
    });

    it('stops the container reaching a viewer that unsubscribes', async () => {
      // Releasing the feed is only half of it. The room is what carries lines to
      // a socket, and a connection that has unsubscribed is free to follow
      // another container - so a room it never left delivers the first one's
      // lines into the second one's pane as soon as anybody reopens that feed.
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);
      expect([...socket.rooms], 'the subscription put it here').to.deep.equal(['applogs:abc123']);

      await socket.fire('unsubscribe');

      expect([...socket.rooms], 'still receiving a container it stopped watching').to.be.empty;
    });

    it('leaves no room behind when the stream could not be opened', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      container.logs = sinon.stub().rejects(new Error('daemon went away'));

      await subscribe(socket);

      expect(appLogsHandler.feeds.has('abc123'), 'nothing was opened').to.be.false;
      expect([...socket.rooms], 'a failed subscribe is not a subscription').to.be.empty;
    });

    it('does not hand a late viewer lines the room is about to send it', async () => {
      // Every line goes into both `recent` and `queued`, so whatever is queued
      // when a second viewer joins is also the tail of `recent` and is about to
      // reach it through the room. Sending the whole of `recent` delivers that
      // tail twice - the one thing a log pane must never do.
      const clock = sinon.useFakeTimers();
      try {
        const nsp = makeNamespace();
        const a = makeSocket('s1', nsp);
        appLogsHandler(a);
        await subscribe(a);

        logStream.emit('data', frame('one\ntwo\n'));
        clock.tick(appLogsHandler.BATCH_MS);          // one and two are delivered and drained
        logStream.emit('data', frame('three\nfour\n')); // still queued, not yet flushed

        const b = makeSocket('s2', nsp);
        appLogsHandler(b);
        await subscribe(b);

        const backfill = b.emit.getCalls().filter((c) => c.args[0] === 'logs');
        expect(backfill, 'the late viewer got no context at all').to.have.length(1);
        expect(
          backfill[0].args[1].lines,
          'the queued tail was sent as backfill and will arrive again on the next flush',
        ).to.deep.equal(['one', 'two']);

        clock.tick(appLogsHandler.BATCH_MS);
        const roomFrames = emitted.filter((e) => e.event === 'logs');
        expect(roomFrames[roomFrames.length - 1].payload.lines).to.deep.equal(['three', 'four']);
      } finally {
        clock.restore();
      }
    });

    it('refuses a second container on one connection', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);

      await subscribe(socket, 'fluxother_app2');

      expect(socket.emit.calledWith('error', 'This connection already follows a container.')).to.be.true;
      expect(container.logs.callCount).to.equal(1);
    });
  });

  describe('the connection\'s one slot', () => {
    // Two containers rather than one, so a claim that is not held across the
    // daemon's answer shows as two feeds instead of as one feed opened twice.
    // The streams are handed out one per call, which is what the daemon does:
    // a single shared stream object cannot show a second one left running.
    const twoContainers = () => {
      const streams = [];
      const newStream = () => {
        const stream = new EventEmitter();
        stream.destroyed = false;
        stream.destroy = () => { stream.destroyed = true; stream.removeAllListeners(); };
        streams.push(stream);
        return stream;
      };
      const byName = {
        fluxa_myapp: { id: 'containerA', logs: sinon.stub().callsFake(async () => newStream()) },
        fluxb_myapp: { id: 'containerB', logs: sinon.stub().callsFake(async () => newStream()) },
      };
      getDockerContainerByIdOrName.callsFake(async (name) => byName[name]);
      return streams;
    };

    it('refuses a second container claimed in the same tick', async () => {
      const streams = twoContainers();
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      // Fired together rather than one after the other. The daemon answers a
      // round trip after it is asked, and a claim taken only once it has
      // answered is one that two subscribes arriving together both look past.
      await Promise.all([
        socket.fire('subscribe', 'zelidauth', 'fluxa_myapp'),
        socket.fire('subscribe', 'zelidauth', 'fluxb_myapp'),
      ]);

      expect(
        socket.emit.calledWith('error', 'This connection already follows a container.'),
        'the second subscribe was accepted while the first was still being set up',
      ).to.be.true;
      expect([...appLogsHandler.feeds.keys()]).to.deep.equal(['containerA']);

      await socket.fire('disconnect');

      expect(
        appLogsHandler.feeds.size,
        'a feed the disconnect cannot name keeps a departed subscriber and nothing can close it',
      ).to.equal(0);
      expect(
        streams.filter((stream) => !stream.destroyed),
        'a docker follow stream, its interval and its decoding running for nobody',
      ).to.be.empty;
    });

    it('stands a subscribe down when the connection unsubscribes while authorisation is in flight', async () => {
      let releaseAuth;
      verifyPrivilege.returns(new Promise((resolve) => { releaseAuth = resolve; }));
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      const pending = subscribe(socket);
      await socket.fire('unsubscribe');
      releaseAuth(true);
      await pending;

      expect(container.logs.called, 'the unsubscribe was passed over and the feed opened anyway').to.be.false;
      expect(appLogsHandler.feeds.size).to.equal(0);
      expect(socket.emit.calledWith('subscribed'), 'the connection was left following what it asked to leave').to.be.false;
    });

    it('frees the slot when the container is not there, so the connection can ask again', async () => {
      getDockerContainerByIdOrName.resolves(null);
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await subscribe(socket);
      expect(socket.emit.calledWith('error', 'Container not found.')).to.be.true;

      getDockerContainerByIdOrName.resolves(container);
      await subscribe(socket);

      expect(
        socket.emit.calledWith('subscribed', { container: 'abc123' }),
        'a subscribe that reached nothing kept the slot for the life of the connection',
      ).to.be.true;
    });
  });

  describe('two viewers opening at once', () => {
    // The daemon answers a round trip after it is asked, and the tests above
    // subscribe one viewer at a time against a single stream object - so a
    // second open, and the stream it strands, are unreachable from them. These
    // hold the answer open and hand back a new stream per call, which is what
    // the daemon does. destroy() drops the listeners with it: a destroyed
    // stream delivers nothing further, and a test that lets one keep emitting
    // would report a leak that production does not have, and miss the one it
    // does.
    let resolvers;
    let streams;

    const newStream = () => {
      const stream = new EventEmitter();
      stream.destroyed = false;
      stream.destroy = () => { stream.destroyed = true; stream.removeAllListeners(); };
      streams.push(stream);
      return stream;
    };

    const answerDaemon = () => resolvers.splice(0).forEach((resolve) => resolve(newStream()));

    const bothSubscribe = (first, second) => Promise.all([
      first.fire('subscribe', 'zelidauth', 'fluxcomp_myapp'),
      second.fire('subscribe', 'zelidauth', 'fluxcomp_myapp'),
    ]);

    beforeEach(() => {
      resolvers = [];
      streams = [];
      container.logs = sinon.stub().callsFake(() => new Promise((resolve) => { resolvers.push(resolve); }));
    });

    it('opens one docker stream for two viewers arriving in the same tick', async () => {
      const nsp = makeNamespace();
      const a = makeSocket('s1', nsp);
      const b = makeSocket('s2', nsp);
      appLogsHandler(a); appLogsHandler(b);

      const settled = bothSubscribe(a, b);
      await until(() => resolvers.length > 0);
      answerDaemon();
      await settled;

      expect(container.logs.callCount, 'the second viewer looked into the gap before the first had claimed it').to.equal(1);
      expect(appLogsHandler.feeds.get('abc123').subscribers.size, 'both viewers hold the one feed').to.equal(2);
    });

    it('leaves nothing following the container once both of them go', async () => {
      const nsp = makeNamespace();
      const a = makeSocket('s1', nsp);
      const b = makeSocket('s2', nsp);
      appLogsHandler(a); appLogsHandler(b);
      const settled = bothSubscribe(a, b);
      await until(() => resolvers.length > 0);
      answerDaemon();
      await settled;

      await a.fire('disconnect');
      await b.fire('disconnect');

      expect(streams.filter((stream) => !stream.destroyed), 'a stream nothing holds cannot ever be closed').to.be.empty;
    });

    it('hands a viewer that arrives afterwards each line once', async () => {
      // The line a stranded stream decodes goes into whatever feed is current,
      // so one racing pair is enough to double every line for every viewer of
      // that container from then on - none of whom raced anything.
      const nsp = makeNamespace();
      const a = makeSocket('s1', nsp);
      const b = makeSocket('s2', nsp);
      appLogsHandler(a); appLogsHandler(b);
      const settled = bothSubscribe(a, b);
      await until(() => resolvers.length > 0);
      answerDaemon();
      await settled;
      await a.fire('disconnect');
      await b.fire('disconnect');

      const late = makeSocket('s3', nsp);
      appLogsHandler(late);
      const alone = late.fire('subscribe', 'zelidauth', 'fluxcomp_myapp');
      await until(() => resolvers.length > 0);
      answerDaemon();
      await alone;

      // The daemon sends the line down every stream it still has open.
      streams.forEach((stream) => stream.emit('data', frame('one-line\n')));

      const delivered = appLogsHandler.feeds.get('abc123').queued.filter((line) => line.includes('one-line'));
      expect(delivered, 'a log pane must never show a line twice').to.have.lengthOf(1);
    });

    it('keeps the second viewer\'s feed when the first goes while the stream is opening', async () => {
      const nsp = makeNamespace();
      const a = makeSocket('s1', nsp);
      const b = makeSocket('s2', nsp);
      appLogsHandler(a); appLogsHandler(b);
      const settled = bothSubscribe(a, b);
      await until(() => resolvers.length > 0);

      a.connected = false;
      await a.fire('disconnect');
      answerDaemon();
      await settled;

      const feed = appLogsHandler.feeds.get('abc123');
      expect(feed, 'the viewer that opened it leaving is not the last viewer leaving').to.not.be.undefined;
      expect(feed.stream.destroyed, 'b is left holding a feed with no stream').to.be.false;
      expect(feed.subscribers.has('s2')).to.be.true;
    });

    it('releases the claim when the daemon refuses, so the next viewer opens', async () => {
      const nsp = makeNamespace();
      const a = makeSocket('s1', nsp);
      const b = makeSocket('s2', nsp);
      appLogsHandler(a); appLogsHandler(b);
      container.logs = sinon.stub().rejects(new Error('daemon went away'));

      await bothSubscribe(a, b);

      expect(appLogsHandler.feeds.has('abc123'), 'a record that will never carry a stream').to.be.false;
      expect(emitted.filter((e) => e.event === 'error'), 'whoever joined on the claim has nothing else to tell them').to.not.be.empty;

      container.logs = sinon.stub().callsFake(() => new Promise((resolve) => { resolvers.push(resolve); }));
      const late = makeSocket('s3', nsp);
      appLogsHandler(late);
      const alone = late.fire('subscribe', 'zelidauth', 'fluxcomp_myapp');
      await until(() => resolvers.length > 0);
      answerDaemon();
      await alone;

      expect(appLogsHandler.feeds.has('abc123'), 'the next viewer opens rather than joining a dead record').to.be.true;
    });
  });

  describe('batching and backpressure', () => {
    it('sends lines collected over the window as one message', async () => {
      const clock = sinon.useFakeTimers();
      try {
        const socket = makeSocket('s1', makeNamespace());
        appLogsHandler(socket);
        await subscribe(socket);

        logStream.emit('data', frame('one\ntwo\n'));
        logStream.emit('data', frame('three\n'));
        expect(emitted.filter((e) => e.event === 'logs'), 'nothing is sent before the window closes').to.have.length(0);

        clock.tick(appLogsHandler.BATCH_MS);

        const frames = emitted.filter((e) => e.event === 'logs');
        expect(frames, 'three writes inside one window are one message').to.have.length(1);
        expect(frames[0].payload.lines).to.deep.equal(['one', 'two', 'three']);
        expect(frames[0].room).to.equal('applogs:abc123');
      } finally {
        clock.restore();
      }
    });

    it('sends nothing at all while the container is quiet', async () => {
      const clock = sinon.useFakeTimers();
      try {
        const socket = makeSocket('s1', makeNamespace());
        appLogsHandler(socket);
        await subscribe(socket);

        clock.tick(appLogsHandler.BATCH_MS * 10);

        expect(emitted, 'an idle container costs no messages').to.have.length(0);
      } finally {
        clock.restore();
      }
    });

    it('drops the oldest and reports the count when a container outruns the socket', async () => {
      const clock = sinon.useFakeTimers();
      try {
        const socket = makeSocket('s1', makeNamespace());
        appLogsHandler(socket);
        await subscribe(socket);

        const over = appLogsHandler.MAX_QUEUED_LINES + 500;
        logStream.emit('data', frame(`${Array.from({ length: over }, (_, i) => `line${i}`).join('\n')}\n`));
        clock.tick(appLogsHandler.BATCH_MS);

        const skips = emitted.filter((e) => e.event === 'skipped');
        expect(skips, 'an unbounded queue makes a loud container the node\'s memory problem').to.have.length(1);
        expect(skips[0].payload.count).to.equal(500);

        const logs = emitted.filter((e) => e.event === 'logs');
        expect(logs[0].payload.lines).to.have.length(appLogsHandler.MAX_QUEUED_LINES);
        expect(logs[0].payload.lines[0], 'the newest are kept, because this is a live tail').to.equal('line500');
      } finally {
        clock.restore();
      }
    });

    // Wider than an argument list. Not reachable through a socket - a 64KB read
    // of the shortest non-empty lines measures 32,768 - so this pins the rule
    // dockerContainerLogsPolling writes down rather than a failure a container
    // can reach today. The width is bounded by the socket's read size, which is
    // not a property of this file and not one a later caller of enqueue carries.
    //
    // Spread, the batch is an argument list V8 refuses, and the RangeError lands
    // in the data handler's guard: no crash, no log line, and every line of the
    // chunk gone before a viewer sees one.
    it('takes a batch wider than an argument list without losing it', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);

      const written = 200000;
      logStream.emit('data', frame('a\n'.repeat(written)));

      const feed = appLogsHandler.feeds.get('abc123');
      expect(feed.queued, 'the whole chunk was lost before a line of it was queued').to.have.length(appLogsHandler.MAX_QUEUED_LINES);
      expect(feed.dropped, 'what did not fit is counted and reported, never passed over in silence').to.equal(written - appLogsHandler.MAX_QUEUED_LINES);
      expect(feed.recent, 'a later viewer opens on the tail of what was written').to.have.length(appLogsHandler.BACKFILL_LINES);
    });

    it('reports a drop only once, not on every later flush', async () => {
      const clock = sinon.useFakeTimers();
      try {
        const socket = makeSocket('s1', makeNamespace());
        appLogsHandler(socket);
        await subscribe(socket);

        const over = appLogsHandler.MAX_QUEUED_LINES + 10;
        logStream.emit('data', frame(`${Array.from({ length: over }, (_, i) => `l${i}`).join('\n')}\n`));
        clock.tick(appLogsHandler.BATCH_MS);
        clock.tick(appLogsHandler.BATCH_MS);

        expect(emitted.filter((e) => e.event === 'skipped')).to.have.length(1);
      } finally {
        clock.restore();
      }
    });
  });

  describe('the stream ending', () => {
    it('tells the viewers when the container stops, and keeps nothing running', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);

      logStream.emit('data', frame('final-line-no-newline'));
      logStream.emit('end');

      const logs = emitted.filter((e) => e.event === 'logs');
      expect(logs[0].payload.lines, 'the held partial line is released rather than lost').to.deep.equal(['final-line-no-newline']);
      expect(emitted.some((e) => e.event === 'ended'), 'a pane that stops updating silently looks like a bug').to.be.true;
      expect(appLogsHandler.feeds.has('abc123')).to.be.false;
    });

    it('answers a stream error and closes the feed', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);

      logStream.emit('error', new Error('daemon went away'));

      expect(emitted.some((e) => e.event === 'error')).to.be.true;
      expect(appLogsHandler.feeds.has('abc123')).to.be.false;
    });

    it('does not exit the process when a stream listener throws', async () => {
      // These callbacks are called by the stream, not by socket.io, so the
      // guard that answers a failing socket listener does not reach them. An
      // unhandled throw here reaches apiServer's uncaughtException handler.
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);

      expect(() => logStream.emit('data', Buffer.from([0, 0, 0]))).to.not.throw();
      expect(() => logStream.emit('data', null)).to.not.throw();
    });
  });

  describe('a feed that ends releases the connections holding it', () => {
    const freshStream = () => {
      const stream = new EventEmitter();
      stream.destroyed = false;
      stream.destroy = () => { stream.destroyed = true; stream.removeAllListeners(); };
      return stream;
    };

    it('follows another container once the one it had stopped', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);

      logStream.emit('end');
      expect(appLogsHandler.feeds.has('abc123'), 'the container stopped and the feed closed with it').to.be.false;

      getDockerContainerByIdOrName.resolves({ id: 'def456', logs: sinon.stub().resolves(freshStream()) });
      await subscribe(socket, 'fluxother_app2');

      expect(
        socket.emit.calledWith('error', 'This connection already follows a container.'),
        'the slot outlived the container it named, so ended was terminal for the connection',
      ).to.be.false;
      expect(socket.emit.calledWith('subscribed', { container: 'def456' })).to.be.true;
    });

    it('stops handing a container to a connection whose feed already ended', async () => {
      const clock = sinon.useFakeTimers();
      try {
        const nsp = makeNamespace();
        const stopped = makeSocket('s1', nsp);
        appLogsHandler(stopped);
        await subscribe(stopped);

        logStream.emit('end');

        // The container is started again - the same container, so the same id
        // and the same room - and a second viewer opens a feed for it.
        const restarted = freshStream();
        container.logs = sinon.stub().resolves(restarted);
        const next = makeSocket('s2', nsp);
        appLogsHandler(next);
        await subscribe(next);

        restarted.emit('data', frame('after the restart\n'));
        clock.tick(appLogsHandler.BATCH_MS);

        expect(
          next.received.filter((r) => r.event === 'logs'),
          'the viewer that asked for the feed was not given it',
        ).to.not.be.empty;
        expect(
          stopped.received.filter((r) => r.event === 'logs'),
          'a pane that fell back to the poll was handed the new feed too, and showed every line twice',
        ).to.be.empty;
      } finally {
        clock.restore();
      }
    });
  });

  describe('a client that leaves mid-setup', () => {
    it('opens no feed when the client goes while authorisation is in flight', async () => {
      let releaseAuth;
      verifyPrivilege.returns(new Promise((resolve) => { releaseAuth = resolve; }));
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      const pending = subscribe(socket);
      await socket.fire('disconnect');
      socket.connected = false;
      releaseAuth(true);
      await pending;

      expect(container.logs.called, 'a feed with no viewer has nobody left to close it').to.be.false;
      expect(appLogsHandler.feeds.size).to.equal(0);
    });

    it('releases the feed when the client goes while the stream is opening', async () => {
      let releaseLogs;
      container.logs.returns(new Promise((resolve) => { releaseLogs = resolve; }));
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      const pending = subscribe(socket);
      // The stream must actually be opening before the client goes, or the
      // check that precedes the open catches it and there is no race to test.
      await until(() => container.logs.called);
      await socket.fire('disconnect');
      socket.connected = false;
      releaseLogs(logStream);
      await pending;

      expect(appLogsHandler.feeds.has('abc123'), 'the disconnect ran before there was a feed to release').to.be.false;
      expect(logStream.destroy.called, 'the stream opened with nobody to read it and nothing left to close it').to.be.true;
    });
  });
});
