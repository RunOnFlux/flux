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
 * How many containers one connection may follow.
 *
 * Ten, because an app is capped at ten components (`appValidator.js:679`), so
 * this is a viewer following every container of the largest app it can be
 * looking at.
 *
 * It bounds a connection's own bookkeeping, not the node's work. The most
 * streams a node can have open is the number of containers it runs, whatever
 * any client does: `feeds` is keyed by container and one stream serves every
 * viewer of it, so connecting more times opens no more streams.
 */
const MAX_FOLLOWED = 10;

/**
 * One docker stream per container, however many viewers are watching it.
 *
 * The alternative is a stream per subscriber, which multiplies the daemon's work
 * and this process's decoding by the number of people looking. Fan-out is what
 * socket.io rooms are for, so the stream is opened by the first subscriber and
 * closed by the last one leaving. Module scope because the streams outlive the
 * connection that opened them.
 *
 * @type {Map<string, {stream: object, queued: string[], dropped: number, timer: object, subscribers: Set<object>}>}
 */
const feeds = new Map();

const roomFor = (containerId) => `applogs:${containerId}`;

/**
 * Stop a feed and forget it. Safe to call for a container with no feed.
 *
 * @param {object} io The namespace the room belongs to
 * @param {string} containerId
 */
function closeFeed(io, containerId) {
  const feed = feeds.get(containerId);
  if (!feed) return;
  // The room goes with the feed. A viewer left in it after the stream ended is
  // still a member when the container is started again and someone else opens a
  // fresh feed for the same id - it would be handed that feed's lines without
  // having asked for them, into a pane that has already fallen back to the poll
  // and is showing every line twice. Emptied here because a feed knows its room
  // and cannot reach the connections that hold it.
  io.socketsLeave(roomFor(containerId));
  // And the record each viewer keeps of following this container, which is the
  // other half of the same subscription. A connection cannot be reached from
  // here except through its viewers, so the record carries the way to forget
  // it. Left behind, it counts against that connection's limit for the life of
  // the socket while naming a container it no longer follows - and the id it
  // names may since have been filed to somebody else's feed.
  feed.subscribers.forEach((entry) => entry.forget());
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

  // Named on every message, because a connection may follow several containers
  // and a batch that does not say which one it belongs to can only be read by a
  // client that follows exactly one. Additive: a client that reads `lines` and
  // ignores the rest is unaffected.
  if (feed.dropped) {
    io.to(roomFor(containerId)).emit('skipped', { container: containerId, count: feed.dropped });
    feed.dropped = 0;
  }
  if (feed.queued.length) {
    const lines = feed.queued;
    feed.queued = [];
    io.to(roomFor(containerId)).emit('logs', { container: containerId, lines });
  }

  // A line too long to hold was handed over cut, and this is what was cut from
  // it. Its own event rather than `skipped`, which counts LINES the queue could
  // not carry: a truncated line is one the viewer HAS, missing its tail, and
  // reporting it as a skipped line would name the wrong thing and the wrong
  // unit. Additive, like `skipped`: a client that reads `lines` and ignores the
  // rest is unaffected.
  //
  // AFTER the lines, unlike `skipped` above. That one announces lines that never
  // arrived, which belongs ahead of the ones that did; this one is about a line
  // the viewer is being shown, so a reader meets the cut line first and then
  // what was cut from it. Sent whether or not this batch carries lines, because
  // a line that ends on the last character of a chunk settles what was cut from
  // it with nothing queued behind it.
  if (feed.truncated) {
    io.to(roomFor(containerId)).emit('truncated', { container: containerId, characters: feed.truncated });
    feed.truncated = 0;
  }
}

/**
 * Take the container's feed record. Filed before anything is awaited.
 *
 * Nothing may be awaited between the caller's `feeds.get` and this claim: two
 * viewers opening one container in the same tick must find one feed between
 * them. The map holds one record per container, so a second stream for the same
 * container is held by nothing, cannot be destroyed, and follows the container
 * for the life of the process - delivering every line to the room twice.
 *
 * Returned rather than kept private, because a subscription is held by the
 * record and not by the id. Ids survive a container's restart; the record is
 * what makes one subscription distinguishable from the next.
 *
 * @param {string} containerId
 * @returns {object} the feed record, already filed
 */
function claimFeed(containerId) {
  const feed = {
    stream: null, queued: [], dropped: 0, truncated: 0, timer: null, subscribers: new Set(), recent: [], closed: false,
  };
  feeds.set(containerId, feed);
  return feed;
}

/**
 * Open the docker follow stream for a container, once.
 *
 * @param {object} io The namespace to emit on
 * @param {object} container The dockerode container
 * @param {string} containerId
 * @param {object} feed The record `claimFeed` filed for this container
 * @returns {Promise<void>} resolves once the stream is attached
 */
async function openFeed(io, container, containerId, feed) {
  // Bounded, unlike the polling read's decoder: that one is handed a single
  // payload and is bounded by it, while this lives for as long as a viewer
  // watches, and a container that never writes a newline would otherwise decide
  // how much of the node's memory that costs - and then send all of it.
  const decoder = new LogFrameDecoder({
    maxLineLength: LogFrameDecoder.MAX_LINE_LENGTH,
    timestamped: true,
  });

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
    // Through closeFeed, the only thing that removes a feed from the map, so
    // "not filed" and "marked closed" always agree - the invariant every holder
    // of a subscription reads. It empties the room too: a viewer left in a room
    // whose feed has gone is handed the lines of whatever feed opens for that id
    // next, into a pane that has already fallen back to the poll.
    //
    // Guarded by identity, because a failing open can be the stale one - the
    // feed it claimed already closed and the container reopened by another
    // viewer. Emptying that room would leave a live feed's viewers subscribed to
    // a stream that can no longer reach them.
    if (feeds.get(containerId) === feed) {
      io.to(roomFor(containerId)).emit('error', 'Log stream error.', containerId);
      closeFeed(io, containerId);
    }
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

  // This stream outlives the feed it was opened for: closeFeed destroys it, and
  // the events that follow a destroy still arrive here - by which time a later
  // viewer's feed can be filed under the same container id. So the handlers below
  // act on the record this stream belongs to and stand down once it is closed,
  // which "no longer filed" always agrees with. Reaching for the id instead hands
  // a dead subscription's lines to the live one that replaced it, and lets a dead
  // stream's error close a subscription it never had.
  const enqueue = (lines) => {
    if (!lines.length || feed.closed) return;

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
    for (let i = 0; i < lines.length; i += 1) feed.recent.push(lines[i]);
    if (feed.recent.length > BACKFILL_LINES) feed.recent = feed.recent.slice(-BACKFILL_LINES);

    const space = MAX_QUEUED_LINES - feed.queued.length;
    if (lines.length > space) {
      feed.dropped += lines.length - space;
      // From the offset rather than through a slice: the tail is all that is
      // kept, and building it as an array of its own to hand over is an
      // allocation of the same width for nothing.
      for (let i = lines.length - space; i < lines.length; i += 1) feed.queued.push(lines[i]);
      return;
    }
    for (let i = 0; i < lines.length; i += 1) feed.queued.push(lines[i]);
  };

  stream.on('data', guard('stream data', (chunk) => {
    enqueue(decoder.push(chunk));
    feed.truncated += decoder.takeTruncated();
  }));

  stream.on('error', guard('stream error', (error) => {
    if (feed.closed) return;
    log.error(`appLogsHandler: stream error for ${containerId}: ${error.message}`);
    io.to(roomFor(containerId)).emit('error', 'Log stream error.', containerId);
    closeFeed(io, containerId);
  }));

  // The container stopped, so docker closed the stream. Told before the feed
  // goes, so a viewer shows a stopped container rather than a pane that quietly
  // stops updating - and the connection is free to follow it again when it is
  // started, because the entry holding it names a feed that is now closed.
  stream.on('end', guard('stream end', () => {
    if (feed.closed) return;
    enqueue(decoder.flush());
    feed.truncated += decoder.takeTruncated();
    flush(io, containerId);
    io.to(roomFor(containerId)).emit('ended', { container: containerId });
    closeFeed(io, containerId);
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
  // What this connection follows, by container, each entry holding the feed
  // record itself rather than the id it is filed under. Ids are names and names
  // are reused - a container keeps its id across a restart - so an entry that
  // held only an id cannot tell its own feed from the one another viewer opens
  // for that container later.
  //
  // A map rather than a single slot, because nothing about a log stream is
  // exclusive. The terminal takes one container per connection because `cmd`
  // and `resize` name no session; everything here is addressed by room and
  // keyed by container, and one docker stream serves every viewer of a
  // container however they are connected. A connection following ten containers
  // costs the node what ten connections following one each cost it, measured,
  // and saves nine sockets.
  /** @type {Map<string, {containerId: string, name: string, feed: object|null, abandoned: boolean}>} */
  const following = new Map();
  // Subscribes that have not settled. A pass reaches `following` only once the
  // daemon has named its container; an unsubscribe arriving before that marks
  // the pass here, so a connection cannot end up following a container it has
  // asked to leave.
  const pending = new Set();
  let clientGone = false;

  // By container rather than by the slot, because the two get out of step
  // exactly when it matters: a disconnect during the open runs leave() before
  // there is a feed, finds nothing to release, and gives the slot up - so the
  // pass that finally has a feed would have nothing to name it by, and the
  // stream and its interval would run on with no viewer and nobody to stop them.
  const release = (containerId, entry) => {
    // Above the return, because the room is the half of a subscription that
    // outlives having no feed: a subscribe whose open failed has nothing to
    // release and used to carry the room out with it. And a connection that has
    // given its slot up is free to follow a second container while a room it
    // never left still delivers the first one's lines into that pane.
    socket.leave(roomFor(containerId));
    const feed = feeds.get(containerId);
    if (!feed) return;
    if (entry) feed.subscribers.delete(entry);
    // The last viewer left, so nothing is reading what the daemon is sending.
    if (!feed.subscribers.size) closeFeed(io, containerId);
  };

  const leave = (containerId) => {
    const entry = following.get(containerId);
    if (!entry) return;
    // Marked as well as dropped, because a subscribe still in setup holds this
    // record and has no other way to learn the subscription was given up: the
    // flag is what tells that pass to stand down rather than to finish and
    // leave the connection following a container it has asked to leave.
    entry.abandoned = true;
    following.delete(containerId);
    release(containerId, entry);
  };

  /**
   * Give up everything this connection follows, or only what `name` names.
   *
   * @param {string|null} name a container id, the name a subscribe asked with,
   *   or null for all of them
   */
  const leaveMatching = (name) => {
    pending.forEach((pass) => {
      if (!name || pass.name === name) pass.abandoned = true;
    });
    [...following.values()]
      .filter((entry) => !name || entry.containerId === name || entry.name === name)
      .forEach((entry) => leave(entry.containerId));
  };

  // Registered at connection, ahead of any message: a disconnect can land while
  // authorisation and the docker lookup are still in flight, and socket.io emits
  // 'disconnect' exactly once - a listener added after it was delivered never
  // fires, and the feed it should have released would outlive every viewer.
  socket.on('disconnect', () => {
    clientGone = true;
    leaveMatching(null);
  });

  // Named by whatever the client called it - the id it was given back, or the
  // name it subscribed with. Matching both is what lets a viewer give up one
  // container without a docker lookup to resolve what it already holds. No
  // argument leaves everything, which is what a client that follows one
  // container sends.
  socket.on('unsubscribe', (nameOrId) => {
    leaveMatching(typeof nameOrId === 'string' ? nameOrId : null);
  });

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
      socket.emit('error', 'Not authorized.', nameOrId);
      return;
    }
    // Refused before the signature is checked, so a connection at its limit
    // cannot spend the node's verification on a subscribe that cannot be
    // accepted. The passes still in setup count too: a pass reaches `following`
    // only after the verification and the docker lookup, so counting the
    // settled ones alone lets any number of subscribes arriving together run
    // both of those in parallel and be refused afterwards - the cost this
    // refusal exists to avoid, taken as many times as they were sent.
    //
    // A pass stays in `pending` until its setup ends, which is after it has taken
    // a container, so the two sets overlap. What this gate is owed is the
    // containers the connection is committed to - the ones it holds and the
    // passes that have yet to name one - and adding the whole of both charges a
    // pass in mid-open twice, refusing a tenth container to a connection with
    // nine open. A pass holds a container exactly when it carries its id.
    //
    // The count is checked again at the claim below, where nothing is awaited
    // and it cannot move underneath the decision.
    const settling = [...pending].filter((pass) => !pass.containerId).length;
    if (following.size + settling >= MAX_FOLLOWED) {
      socket.emit('error', `This connection already follows ${MAX_FOLLOWED} containers.`, nameOrId);
      return;
    }

    const mine = {
      containerId: null,
      name: nameOrId,
      feed: null,
      abandoned: false,
      // How the feed reaches back to this connection when it closes. Nothing at
      // module scope can see `following`, so the record carries the way to
      // forget it - guarded by identity, because a later pass may have taken
      // this container over and its record is not this one's to remove.
      forget: () => {
        if (mine.containerId && following.get(mine.containerId) === mine) {
          following.delete(mine.containerId);
        }
      },
    };
    pending.add(mine);

    const mainAppName = nameOrId.split('_')[1] || nameOrId;

    // Gives up what this pass took, and only while the entry is still this
    // pass's. A pass abandoned mid-setup can be overtaken by a later subscribe
    // for the same container: releasing then would take the room and the feed
    // out from under the pass that now holds them.
    const drop = () => {
      if (!mine.containerId || following.get(mine.containerId) !== mine) return;
      following.delete(mine.containerId);
      release(mine.containerId, mine);
    };

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
        socket.emit('error', 'Not authorized.', nameOrId);
        return;
      }

      const container = await dockerService.getDockerContainerByIdOrName(nameOrId).catch((error) => {
        log.error(`appLogsHandler: container lookup failed for ${nameOrId}: ${error.message}`);
        return null;
      });
      if (!container) {
        socket.emit('error', 'Container not found.', nameOrId);
        return;
      }

      // The client may have gone, or given this subscription up, while the
      // awaits above ran. Nothing is held yet, so there is nothing to release.
      if (mine.abandoned || clientGone || !socket.connected) return;

      const containerId = container.id;

      // From here to the feed being in hand, nothing is awaited: the entry, the
      // count and the feed identity are settled in one tick, so a second
      // subscribe cannot pass a check this pass is about to invalidate.
      const held = following.get(containerId);
      if (held && held.feed && !held.feed.closed) {
        // Already receiving it, which is the only thing 'subscribed' says.
        // Answering it again is the honest reply to a client that asked twice,
        // and costs the node nothing: the feed is shared and the room already
        // carries it.
        if (held.feed.subscribers.has(held)) {
          socket.emit('subscribed', { container: containerId });
          return;
        }
        // Held by a pass that is still opening the stream. Answering
        // 'subscribed' here would say a feed exists before it does, and leave
        // the client believing it while an open that then fails is reported to
        // the pass that made it. That pass answers for both.
        return;
      }
      if (!held && following.size >= MAX_FOLLOWED) {
        socket.emit('error', `This connection already follows ${MAX_FOLLOWED} containers.`, nameOrId);
        return;
      }
      // Whatever the dead entry's pass is still doing, it stands down rather
      // than releasing the container this pass is about to take.
      if (held) held.abandoned = true;

      mine.containerId = containerId;
      following.set(containerId, mine);
      socket.join(roomFor(containerId));

      const existing = feeds.get(containerId);
      if (!existing) {
        mine.feed = claimFeed(containerId);
        await openFeed(io, container, containerId, mine.feed);
      } else {
        mine.feed = existing;
        if (existing.recent.length) {
          // Sent to this socket alone, and only the part the room will NOT send
          // again. Every line is put in both `recent` and `queued`, so whatever
          // is queued right now is also the tail of `recent` and is about to
          // arrive here through the room - handing the whole of `recent` over
          // delivers that tail twice, which is the one thing a log pane must
          // never do.
          //
          // The two are read in the same tick with nothing awaited between them,
          // and only a stream 'data' event appends to either, so this is a
          // consistent snapshot rather than a race narrowed.
          const alsoComing = Math.min(existing.queued.length, existing.recent.length);
          const backfill = existing.recent.slice(0, existing.recent.length - alsoComing);
          if (backfill.length) socket.emit('logs', { container: containerId, lines: backfill });
        }
      }

      // Re-checked after that await. The feed was opened during it, so this is
      // the pass that has to give it up - and it releases whether or not the
      // disconnect that preceded it already did: release() is written to find
      // nothing and return.
      if (mine.abandoned || clientGone || !socket.connected) {
        drop();
        return;
      }

      // The feed this pass claimed is no longer the container's: the last viewer
      // left while the daemon was answering, or the stream failed on open.
      // 'subscribed' here would attach a pane to nothing, with no 'ended' or
      // 'error' to fall back from.
      if (feeds.get(containerId) !== mine.feed) {
        drop();
        socket.emit('error', 'Log stream error.', containerId);
        return;
      }

      mine.feed.subscribers.add(mine);
      socket.emit('subscribed', { container: containerId });
    } catch (error) {
      log.error(`appLogsHandler: ${nameOrId}: ${error.message}`);
      socket.emit('error', 'Error following logs.', nameOrId);
      drop();
    } finally {
      pending.delete(mine);
    }
  });
}

module.exports = appLogsHandler;
module.exports.feeds = feeds;
module.exports.BATCH_MS = BATCH_MS;
module.exports.MAX_QUEUED_LINES = MAX_QUEUED_LINES;
module.exports.BACKFILL_LINES = BACKFILL_LINES;
module.exports.MAX_FOLLOWED = MAX_FOLLOWED;
