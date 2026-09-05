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
  const stream = await container.logs({
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

  const decoder = new LogFrameDecoder();
  const feed = {
    stream, queued: [], dropped: 0, timer: null, subscribers: new Set(), recent: [],
  };
  feeds.set(containerId, feed);

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

    // Kept so a viewer that joins a stream already running opens with the same
    // context the first one got from docker's `tail`, rather than an empty pane
    // until the container next writes.
    room.recent.push(...lines);
    if (room.recent.length > BACKFILL_LINES) room.recent = room.recent.slice(-BACKFILL_LINES);

    const space = MAX_QUEUED_LINES - room.queued.length;
    if (lines.length > space) {
      room.dropped += lines.length - space;
      room.queued.push(...lines.slice(lines.length - space));
      return;
    }
    room.queued.push(...lines);
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
  // What this connection is watching, so a disconnect can release it. One
  // container per connection, the same bargain the terminal makes.
  let watching = null;
  let clientGone = false;

  // By container rather than by `watching`, because the two get out of step
  // exactly when it matters: a disconnect during the open runs leave() before
  // there is a feed, finds nothing to release, and clears `watching` - so the
  // pass that finally has a feed would have nothing to name it by, and the
  // stream and its interval would run on with no viewer and nobody to stop them.
  const release = containerId => {
    const feed = feeds.get(containerId);
    if (!feed) return;
    feed.subscribers.delete(socket.id);
    // The last viewer left, so nothing is reading what the daemon is sending.
    if (!feed.subscribers.size) closeFeed(containerId);
  };

  const leave = () => {
    if (!watching) return;
    release(watching);
    watching = null;
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
    if (watching) {
      socket.emit('error', 'This connection already follows a container.');
      return;
    }

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
        socket.emit('error', 'Not authorized.');
        return;
      }

      const container = await dockerService.getDockerContainerByIdOrName(nameOrId).catch((error) => {
        log.error(`appLogsHandler: container lookup failed for ${nameOrId}: ${error.message}`);
        return null;
      });
      if (!container) {
        socket.emit('error', 'Container not found.');
        return;
      }

      // The client may have gone while the awaits above ran. Its disconnect has
      // already been delivered and found nothing to release, so opening a feed
      // now would leave one with no viewer and nobody left to close it.
      if (clientGone || !socket.connected) return;

      const containerId = container.id;
      watching = containerId;
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

      // Re-checked after that await. A disconnect that landed during it has
      // already run leave() and found no feed to release, so this is the only
      // pass that can close what was just opened.
      if (clientGone || !socket.connected) {
        release(containerId);
        watching = null;
        return;
      }

      feeds.get(containerId)?.subscribers.add(socket.id);
      socket.emit('subscribed', { container: containerId });
    } catch (error) {
      log.error(`appLogsHandler: ${nameOrId}: ${error.message}`);
      socket.emit('error', 'Error following logs.');
      leave();
    }
  });
}

module.exports = appLogsHandler;
module.exports.feeds = feeds;
module.exports.BATCH_MS = BATCH_MS;
module.exports.MAX_QUEUED_LINES = MAX_QUEUED_LINES;
module.exports.BACKFILL_LINES = BACKFILL_LINES;
