const verificationHelper = require('../../services/verificationHelper');
const { Privilege } = require('../../services/utils/privileges');
const dockerService = require('../../services/dockerService');
const LogFrameDecoder = require('../../services/utils/logFrameDecoder');

const log = require('../log');

/**
 * How long lines are collected before they are sent as one message.
 *
 * A line at a time is what makes a stream cost more than the poll it replaces:
 * a container writing 1,000 lines a second would be 1,000 socket.io messages a
 * second per node, where a three-second poll answered the same 3,000 lines in
 * one bounded read. Collecting them puts the message rate under our control and
 * leaves it flat however loud the container is. Loki's tail endpoint carries the
 * same idea as `delay_for`.
 */
const BATCH_MS = 250;

/**
 * The most lines held for one container between two flushes.
 *
 * Reached only by a container writing faster than the socket drains, and the
 * answer then is to drop and say so rather than to buffer without limit - an
 * unbounded queue turns a loud container into the node's memory problem. What
 * was dropped is counted and reported, never passed over in silence.
 */
const MAX_QUEUED_LINES = 20000;

/**
 * Lines sent to a subscriber before the live ones, so a viewer opens with
 * context instead of an empty pane until the container next writes.
 */
const BACKFILL_LINES = 200;

/**
 * One docker stream per container, however many viewers are watching it.
 *
 * The alternative is a stream per subscriber, which multiplies the daemon's work
 * and this process's decoding by the number of people looking. Fan-out is what
 * socket.io rooms are for, so the stream is opened by the first subscriber and
 * closed by the last one leaving. Module scope because the streams outlive the
 * connection that opened them.
 *
 * @type {Map<string, {stream: object, queued: string[], dropped: number, timer: object, subscribers: Set<string>}>}
 */
const feeds = new Map();

const roomFor = (containerId) => `applogs:${containerId}`;

/**
 * Stop a feed and forget it. Safe to call for a container with no feed.
 *
 * @param {string} containerId
 */
function closeFeed(containerId) {
  const feed = feeds.get(containerId);
  if (!feed) return;
  // Marked as well as dropped, because a feed can be closed while its stream is
  // still being opened: the open has no way back to this map once the record is
  // gone, and the flag is what tells it the stream it is holding has no viewer.
  feed.closed = true;
  clearInterval(feed.timer);
  // destroy() rather than a docker call: this is the response stream, and
  // destroying it is what tells the daemon to stop following.
  if (feed.stream) feed.stream.destroy();
  feeds.delete(containerId);
}

/**
 * Send what has collected since the last flush, and say what did not fit.
 *
 * @param {object} io The namespace to emit on
 * @param {string} containerId
 */
function flush(io, containerId) {
  const feed = feeds.get(containerId);
  if (!feed) return;

  if (feed.dropped) {
    io.to(roomFor(containerId)).emit('skipped', { count: feed.dropped });
    feed.dropped = 0;
  }
  if (!feed.queued.length) return;

  const lines = feed.queued;
  feed.queued = [];
  io.to(roomFor(containerId)).emit('logs', { lines });
}

/**
 * Open the docker follow stream for a container, once.
 *
 * @param {object} io The namespace to emit on
 * @param {object} container The dockerode container
 * @param {string} containerId
 * @returns {Promise<void>} resolves once the stream is attached
 */
async function openFeed(io, container, containerId) {
  const decoder = new LogFrameDecoder();
  const feed = {
    stream: null, queued: [], dropped: 0, timer: null, subscribers: new Set(), recent: [], closed: false,
  };
  // Claimed BEFORE the daemon is asked, with nothing awaited between the
  // caller's `feeds.get` and this line. Two viewers opening the same container
  // in one tick both looked into the gap this closes, both found nothing, and
  // both opened a stream - and the second one replaced the first in this map,
  // which is the only reference to it. A stream nothing holds cannot be
  // destroyed: it follows the container for the life of the process and its
  // data handler keeps resolving `feeds.get(containerId)` to whatever feed is
  // current, so every later viewer of that container sees every line twice.
  feeds.set(containerId, feed);

  let stream;
  try {
    stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
      // Bounded, like every other read this codebase makes of a log. `follow`
      // with a `tail` opens at the end of the file and costs nothing to
      // establish - measured on a live node at 2 CPU ticks against a 1 tick
      // idle baseline, where the same read without a `tail` costs 15.
      tail: BACKFILL_LINES,
    });
  } catch (error) {
    // The claim goes before the throw, so the next viewer opens a stream rather
    // than joining a record that will never carry one. Whoever joined on the
    // strength of it is told through the room: their own subscribe succeeded and
    // has nothing left to report to them.
    if (feeds.get(containerId) === feed) feeds.delete(containerId);
    io.to(roomFor(containerId)).emit('error', 'Log stream error.');
    throw error;
  }

  // The last viewer left while the daemon was answering, so closeFeed has
  // already run and found no stream to destroy. This is the only pass that can.
  if (feed.closed) {
    stream.destroy();
    return;
  }
  feed.stream = stream;

  // Called by the stream, not by socket.io, so the guard that answers a failing
  // socket listener does not reach these. A throw here is a rejection nobody
  // handles, which is a process exit.
  const guard = (label, fn) => (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      log.error(`appLogsHandler: ${label} for ${containerId}: ${error.message}`);
      return undefined;
    }
  };

  const enqueue = (lines) => {
    if (!lines.length) return;
    const room = feeds.get(containerId);
    if (!room) return;

    // Appended rather than spread, which is the rule dockerContainerLogsPolling
    // states and keeps. One chunk finishes as many lines as it has newlines and
    // not as many as it has frames - the decoder splits frame bodies - so a
    // 64KB read of the shortest non-empty lines measures 32,768 against the
    // 125,263 arguments V8 accepts. That margin belongs to the socket's read
    // size rather than to anything here, and crossing it is not a crash: the
    // RangeError lands in the data handler's guard, and every line of the chunk
    // is lost before one of them reaches a viewer.
    //
    // `recent` is kept so a viewer that joins a stream already running opens
    // with the same context the first one got from docker's `tail`, rather than
    // an empty pane until the container next writes.
    for (let i = 0; i < lines.length; i += 1) room.recent.push(lines[i]);
    if (room.recent.length > BACKFILL_LINES) room.recent = room.recent.slice(-BACKFILL_LINES);

    const space = MAX_QUEUED_LINES - room.queued.length;
    if (lines.length > space) {
      room.dropped += lines.length - space;
      // From the offset rather than through a slice: the tail is all that is
      // kept, and building it as an array of its own to hand over is an
      // allocation of the same width for nothing.
      for (let i = lines.length - space; i < lines.length; i += 1) room.queued.push(lines[i]);
      return;
    }
    for (let i = 0; i < lines.length; i += 1) room.queued.push(lines[i]);
  };

  stream.on('data', guard('stream data', (chunk) => enqueue(decoder.push(chunk))));

  stream.on('error', guard('stream error', (error) => {
    log.error(`appLogsHandler: stream error for ${containerId}: ${error.message}`);
    io.to(roomFor(containerId)).emit('error', 'Log stream error.');
    closeFeed(containerId);
  }));

  // The container stopped, so docker closed the stream. The subscribers stay
  // where they are - the room is theirs, not the stream's - and are told, so a
  // viewer shows a stopped container rather than a pane that quietly stops
  // updating.
  stream.on('end', guard('stream end', () => {
    enqueue(decoder.flush());
    flush(io, containerId);
    io.to(roomFor(containerId)).emit('ended');
    closeFeed(containerId);
  }));

  feed.timer = setInterval(() => flush(io, containerId), BATCH_MS);
}

/**
 * Live application logs, pushed.
 *
 * The polling endpoint stays exactly as it is and remains the only thing a node
 * that predates this can offer, so a viewer tries here and falls back to it. The
 * network runs several FluxOS versions at once and always will, which makes that
 * fallback permanent rather than a migration step.
 *
 * @param {object} socket
 * @returns {Promise<void>}
 */
async function appLogsHandler(socket) {
  const io = socket.nsp;
  // The connection's one subscription, taken the moment a subscribe is accepted
  // and before anything is awaited. One container per connection, the same
  // bargain the terminal makes.
  //
  // A record rather than the container id, because the id cannot also be the
  // claim: whether the slot is taken has an answer from this listener's first
  // line, and which container to release has none until the daemon has answered
  // two awaits later. Named by the container, the claim was not made until the
  // second of those returned - so two subscribes arriving in one tick both
  // passed the guard, the second replaced the first, and the disconnect released
  // only the second. The first kept a departed socket.id among its subscribers,
  // which is a count that never reaches zero: a docker follow stream, its
  // interval and its decoding ran on with no viewer, and no later viewer of that
  // container could close it either.
  /** @type {{containerId: string|null, abandoned: boolean}|null} */
  let slot = null;
  let clientGone = false;

  // By container rather than by the slot, because the two get out of step
  // exactly when it matters: a disconnect during the open runs leave() before
  // there is a feed, finds nothing to release, and gives the slot up - so the
  // pass that finally has a feed would have nothing to name it by, and the
  // stream and its interval would run on with no viewer and nobody to stop them.
  const release = containerId => {
    // Above the return, because the room is the half of a subscription that
    // outlives having no feed: a subscribe whose open failed has nothing to
    // release and used to carry the room out with it. And a connection that has
    // given its slot up is free to follow a second container while a room it
    // never left still delivers the first one's lines into that pane.
    socket.leave(roomFor(containerId));
    const feed = feeds.get(containerId);
    if (!feed) return;
    feed.subscribers.delete(socket.id);
    // The last viewer left, so nothing is reading what the daemon is sending.
    if (!feed.subscribers.size) closeFeed(containerId);
  };

  const leave = () => {
    if (!slot) return;
    // Marked as well as dropped, because a subscribe still in setup holds this
    // record and has no other way to learn the slot was given up: the flag is
    // what tells that pass to stand down, rather than to finish and leave the
    // connection following a container it has already asked to leave.
    slot.abandoned = true;
    if (slot.containerId) release(slot.containerId);
    slot = null;
  };

  // Registered at connection, ahead of any message: a disconnect can land while
  // authorisation and the docker lookup are still in flight, and socket.io emits
  // 'disconnect' exactly once - a listener added after it was delivered never
  // fires, and the feed it should have released would outlive every viewer.
  socket.on('disconnect', () => {
    clientGone = true;
    leave();
  });

  socket.on('unsubscribe', () => leave());

  socket.on('subscribe', async (zelidauth, nameOrId) => {
    // Ahead of everything, because this namespace takes no middleware: both
    // arguments are whatever an unauthenticated client serialised, and nothing
    // upstream makes them strings the way node's http parser does for a header.
    //
    // zelidauth is refused here rather than at verifyPrivilege, which throws a
    // TypeError for a non-string on purpose: that TypeError says our own code
    // wired the call wrongly, and it cannot go on meaning that while any
    // stranger can raise it on demand.
    if (typeof nameOrId !== 'string') {
      socket.emit('error', 'No container specified.');
      return;
    }
    if (typeof zelidauth !== 'string') {
      socket.emit('error', 'Not authorized.');
      return;
    }
    if (slot) {
      socket.emit('error', 'This connection already follows a container.');
      return;
    }

    // Taken with nothing awaited between the guard above and this line, so the
    // next subscribe on this connection finds it held however long the daemon
    // takes to answer this one.
    const mine = { containerId: null, abandoned: false };
    slot = mine;

    // Hands the slot back only while this pass still holds it. A pass abandoned
    // mid-setup can be overtaken by the subscribe that follows it, and must not
    // free a slot that one is now using.
    const abandon = message => {
      if (slot === mine) slot = null;
      if (message) socket.emit('error', message);
    };

    const mainAppName = nameOrId.split('_')[1] || nameOrId;

    try {
      // Authorise BEFORE touching docker: the lookup below is a remote-controlled
      // operation on an attacker-supplied name, and must not be reachable by an
      // unauthenticated caller. Through verifyPrivilege like every other caller,
      // so this stream carries a privilege a sweep can find.
      const authorized = await verificationHelper.verifyPrivilege(
        Privilege.APP_OWNER_OR_FLUX_TEAM,
        zelidauth,
        { appName: mainAppName },
      );
      if (authorized !== true) {
        abandon('Not authorized.');
        return;
      }

      const container = await dockerService.getDockerContainerByIdOrName(nameOrId).catch((error) => {
        log.error(`appLogsHandler: container lookup failed for ${nameOrId}: ${error.message}`);
        return null;
      });
      if (!container) {
        abandon('Container not found.');
        return;
      }

      // The client may have gone, or given this subscription up, while the
      // awaits above ran. Either way what would have released it has already run
      // and found no container to name, so opening a feed now would leave one
      // with no viewer and nobody left to close it.
      if (mine.abandoned || clientGone || !socket.connected) {
        abandon();
        return;
      }

      const containerId = container.id;
      mine.containerId = containerId;
      socket.join(roomFor(containerId));

      const existing = feeds.get(containerId);
      if (!existing) {
        await openFeed(io, container, containerId);
      } else if (existing.recent.length) {
        // Sent to this socket alone, and only the part the room will NOT send
        // again. Every line is put in both `recent` and `queued`, so whatever is
        // queued right now is also the tail of `recent` and is about to arrive
        // here through the room - handing the whole of `recent` over delivers
        // that tail twice, which is the one thing a log pane must never do.
        //
        // The two are read in the same tick with nothing awaited between them,
        // and only a stream 'data' event appends to either, so this is a
        // consistent snapshot rather than a race narrowed.
        const alsoComing = Math.min(existing.queued.length, existing.recent.length);
        const backfill = existing.recent.slice(0, existing.recent.length - alsoComing);
        if (backfill.length) socket.emit('logs', { lines: backfill });
      }

      // Re-checked after that await. The feed was opened during it, so this is
      // the pass that has to give it up - and it releases whether or not the
      // disconnect that preceded it already did: release() is written to find
      // nothing and return.
      if (mine.abandoned || clientGone || !socket.connected) {
        release(containerId);
        abandon();
        return;
      }

      feeds.get(containerId)?.subscribers.add(socket.id);
      socket.emit('subscribed', { container: containerId });
    } catch (error) {
      log.error(`appLogsHandler: ${nameOrId}: ${error.message}`);
      socket.emit('error', 'Error following logs.');
      if (mine.containerId) release(mine.containerId);
      abandon();
    }
  });
}

module.exports = appLogsHandler;
module.exports.feeds = feeds;
module.exports.BATCH_MS = BATCH_MS;
module.exports.MAX_QUEUED_LINES = MAX_QUEUED_LINES;
module.exports.BACKFILL_LINES = BACKFILL_LINES;
