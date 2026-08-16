const config = require('config');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs/promises');
const dockerService = require('../dockerService');
const deviceHelper = require('../deviceHelper');
const serviceHelper = require('../serviceHelper');
const networkStateService = require('../networkStateService');
const { bareIp, extractPort } = require('../utils/socketAddressUtils');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const jobRegistry = require('../utils/jobRegistry');
const fluxEventBus = require('../utils/fluxEventBus');
const log = require('../../lib/log');
const { Writable, pipeline } = require('node:stream');
const { createWriteStream, createReadStream } = require('node:fs');
const { AsyncLock } = require('../utils/asyncLock');
const { measureTree } = require('../utils/treeSize');
const { appsFolder } = require('../utils/appConstants');
const {
  VolumePath, VolumeSession, WORK_ROOT,
} = require('./volumeSession');
const {
  isStagingName,
} = require('./volumeReservedNames');

const settings = () => config.fluxapps.volumeOperations;



/**
 * Labels every executor container carries.
 *
 * `role` is what keeps these out of the app sweeps: forceAppRemovals derives an
 * app name from a container name and hands it to removeAppLocally, so a
 * container it does not recognise produces a plausible-looking wrong name. The
 * label answers the question directly instead.
 */
const EXECUTOR_LABELS = { 'runonflux.role': 'fileop' };

// One slot per concurrent operation. Refusing rather than queueing is
// deliberate: a queued request holds its connection open behind someone else's
// long copy until an intermediate proxy kills it, which reads to the user as a
// failure with no explanation.
const nodeLock = new AsyncLock(Number.MAX_SAFE_INTEGER);
const appLocks = new Map();

// Container ids and staging paths of the operations THIS process has in flight.
// Boot recovery removes file-operation containers and staging directories left by
// a PREVIOUS process; consulting these keeps it from reaping one that belongs to an
// operation running right now. Populated by run() for the life of each operation and
// cleared in its finally, so "orphaned" means exactly "owned by no live operation"
// rather than "carries our label" - the API answers requests before recovery runs,
// so an operation can be in flight when it does.
const liveContainerIds = new Set();
const liveStagingPaths = new Set();

function lockForApp(identifier) {
  if (!appLocks.has(identifier)) appLocks.set(identifier, new AsyncLock(Number.MAX_SAFE_INTEGER));
  return appLocks.get(identifier);
}

/**
 * How long to tell a refused caller to wait.
 *
 * Derived from the operation in the way only it is measured: a copy that has
 * moved a known fraction of a known total in a known time says when it will be
 * done. Anything else gets the default: a denominator is only offered where one
 * is real, and an invented wait is worse than an honest shrug.
 *
 * Capped, because an estimate of hours belongs in the job a caller can watch
 * rather than in a header telling it to sleep.
 *
 * @param {{startedAt: number, detail: object}|null} operation
 * @returns {number} milliseconds
 */
function retryAfterFor(operation) {
  const detail = operation && operation.detail;
  if (!detail || !detail.bytesTotal || !detail.bytesDone) return BUSY_RETRY_AFTER_MS;

  const elapsed = Date.now() - operation.startedAt;
  if (elapsed <= 0 || detail.bytesDone >= detail.bytesTotal) return BUSY_RETRY_AFTER_MS;

  const remaining = ((detail.bytesTotal - detail.bytesDone) / detail.bytesDone) * elapsed;
  return Math.min(Math.max(Math.round(remaining), BUSY_RETRY_AFTER_MS), BUSY_RETRY_AFTER_CEILING_MS);
}

/**
 * Take a slot for this app, or throw.
 *
 * The read of activeCount and the register() that follows are not separated by
 * an await, so nothing can interleave between them. It reads like a
 * check-then-act race and is not one - do not "fix" it by adding a lock.
 *
 * @param {string} identifier
 * @returns {function(): void} release
 */
function acquireSlot(identifier) {
  const { maxConcurrentPerApp, maxConcurrentPerNode } = settings();
  const appLock = lockForApp(identifier);

  // Marked `busy` so the HTTP layer answers 503 with a Retry-After rather than
  // a generic failure: a caller turned away before any work started should
  // learn that immediately, not by registering an operation and polling to
  // discover it was refused.
  const busy = (message, operation = null) => {
    const error = new Error(message);
    error.kind = 'busy';
    error.retryAfterMs = retryAfterFor(operation);
    // What the caller is waiting behind, so a refusal is something to watch or
    // cancel rather than an invitation to guess. A client with nothing to name
    // can only retry blindly, which behind a four hour copy is a thousand
    // refusals telling it nothing it did not already know.
    if (operation) {
      error.operation = {
        jobId: operation.jobId,
        kind: operation.kind,
        statusUrl: operation.statusUrl,
      };
    }
    return error;
  };

  if (appLock.activeCount >= maxConcurrentPerApp) {
    const running = jobRegistry.runningForApp(identifier);
    throw busy(
      running
        ? `${running.kind} is already running for ${identifier}`
        : `Another file operation is already running for ${identifier}`,
      running,
    );
  }
  if (nodeLock.activeCount >= maxConcurrentPerNode) {
    throw busy('This node is running its maximum number of file operations; try again shortly');
  }

  appLock.register();
  nodeLock.register();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    appLock.disable();
    nodeLock.disable();
    if (!appLock.activeCount) appLocks.delete(identifier);
  };
}

/**
 * Throw `busy` if this app or the node has no free slot, WITHOUT taking one.
 *
 * Lets a caller refuse before it registers an operation, so the common case is
 * a clean 503 rather than a job that exists only to report that it never began.
 * The real limit is still enforced by acquireSlot; losing the race between the
 * two just means the refusal is recorded against a job instead of a response.
 *
 * @param {VolumeSession} session
 */
function assertCapacity(session) {
  const release = acquireSlot(session.identifier);
  release();
}

/**
 * Confirm the session's mount is a filesystem the kernel currently reports.
 *
 * FluxOS holds the docker socket, so whatever decides a bind source decides
 * host access - a wrong path here is not a containment bug, it is a host
 * compromise. The mount was already SELECTED from the mount table when the
 * session was opened; this re-reads it immediately before the bind so a volume
 * unmounted in between cannot be bound as a plain host directory, which is what
 * would happen if the mountpoint were bound while empty.
 *
 * @param {VolumeSession} session
 */
async function assertMountIsLive(session) {
  if (!session.mount.startsWith(appsFolder)) {
    throw new Error('Application volume is not under the apps folder');
  }
  const mounts = await deviceHelper.listMountedFilesystems();
  if (!mounts.some((mount) => mount.target === session.mount)) {
    throw new Error('Application volume is no longer mounted');
  }
}

/**
 * The identifiers that name the image this node must run - any one of which is
 * proof, because every one of them is derived from the bytes.
 *
 * A tag says which image to fetch; it does not say what is in it. One at a
 * registry can be moved, and one inside an archive a peer hands over is
 * whatever that peer wrote there - so the tag is the name and these are the
 * proof.
 *
 * There are two of them because docker files an image under different content
 * digests depending on how it stores images, and a published image is not one
 * blob: it is an INDEX naming one image per architecture.
 *
 *   classic store       this architecture's own config digest
 *   containerd store    the digest of the index covering every architecture
 *
 * The containerd store is the default from Docker 29, which on 2026-08-14 was
 * 5,587 of the fleet's 6,066 nodes. Pinning only the config digest left every
 * one of them pulling the image successfully and then refusing it - not as a
 * transient failure but for good, since no retry makes two different numbers
 * agree - and taking the whole file browser down with it, `createfolder`,
 * `renameobject` and `removeobject` included.
 *
 * Accepting either weakens nothing. Both are content digests over the same
 * bytes: the index covers the per-architecture manifests, which cover their
 * configs and layers, so neither can be forged without breaking the other.
 *
 * ONCE PRE-29 DOCKER IS OFF THE NETWORK this collapses to the index digest
 * alone - one identifier, no architecture in it. `fluxos-docker-versions` is
 * the survey that says when. Until then the config digest is what the 479
 * remaining older daemons answer with.
 *
 * @returns {Array<string>} most specific first; a held image matching any is
 *   the pinned image
 */
function expectedImageIds() {
  const { image, imageIds, indexId } = settings();
  const architecture = os.arch() === 'x64' ? 'amd64' : os.arch();
  const forArchitecture = imageIds && imageIds[architecture];
  if (!forArchitecture && !indexId) {
    throw new Error(`No file operation image is pinned for ${architecture}, so ${image} cannot be verified`);
  }
  return [forArchitecture, indexId].filter(Boolean);
}

/**
 * Which of them this node actually holds, or null.
 *
 * The answer is the id to RUN as well as the answer to "is it here": a
 * container has to be created from the identifier the local daemon resolves,
 * which is the one that just answered.
 *
 * @returns {Promise<string|null>}
 */
async function heldImageId() {
  // eslint-disable-next-line no-restricted-syntax
  for (const candidate of expectedImageIds()) {
    // eslint-disable-next-line no-await-in-loop
    if (await dockerService.imageExists(candidate)) return candidate;
  }
  return null;
}

/**
 * Monotonic milliseconds. A backoff measured against the wall clock expires
 * early or never when the clock is corrected.
 * @returns {number}
 */
function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/** How long a caller waits for an image already on its way before being told to come back. */
const IMAGE_WAIT_MS = 10000;

/**
 * How long a failed attempt answers callers without searching again.
 *
 * Without it every click repeats the whole search - the registry and four peers
 * - so a node that cannot get the image makes every file operation cost minutes
 * rather than telling the user in milliseconds. The background loop owns
 * retrying; a caller only needs the answer.
 */
const IMAGE_FAILURE_SILENCE_MS = 60000;

/** One registry attempt loses a transient error - a DNS blip, a single 503 - to bad luck. */
const REGISTRY_ATTEMPTS = 2;
const REGISTRY_RETRY_MS = 3000;

/** Between cycles: soon enough that a node whose network returns is not stuck for an hour. */
const ACQUIRE_BACKOFF_MS = 30000;
const ACQUIRE_BACKOFF_CEILING_MS = 60 * 60 * 1000;

let acquiring = null;
let acquiringUsedRegistry = false;
let failedAt = 0;
let backoffMs = 0;
let backoffUntil = 0;
let acquireTimer = null;

/**
 * A refusal the HTTP layer answers 503 to, carrying how long to wait.
 *
 * The node is not broken and the request is not wrong: what it needs is on its
 * way, which is a different thing from a failure and reads differently to
 * whoever is looking at it.
 *
 * @param {number} retryAfterMs
 * @returns {Error}
 */
function imageComing(retryAfterMs) {
  const error = new Error('The file operation image is not on this node yet and is being fetched; try again shortly');
  error.kind = 'busy';
  error.retryAfterMs = Math.min(Math.max(retryAfterMs || IMAGE_WAIT_MS, 5000), 300000);
  return error;
}

/**
 * Where in the window this node asks the REGISTRY, derived from its own address.
 *
 * Derived rather than drawn at random so it is the same slot on every restart:
 * a node that re-rolls picks a new one each boot, which turns a restarting
 * fleet back into the burst the window exists to spread. Hashed because
 * addresses are not evenly distributed and their low bits least of all.
 *
 * @returns {number}
 */
function prefetchDelayMs() {
  const { prefetchWindowMs } = settings();
  const identity = userconfig.initial.ipaddress;
  if (!identity) return Math.floor(prefetchWindowMs / 2);
  const digest = crypto.createHash('sha256').update(identity).digest();
  return digest.readUInt32BE(0) % prefetchWindowMs;
}

/** How many peers are asked for the image before the attempt is given up. */
const PEER_IMAGE_ATTEMPTS = 4;

/** What a refused caller waits when nothing better can be said. */
const BUSY_RETRY_AFTER_MS = 5000;

/** The most a refusal asks anyone to sleep, however long the operation has left. */
const BUSY_RETRY_AFTER_CEILING_MS = 5 * 60 * 1000;

/** How many draws that costs at most, since the same peer can come up twice. */
const PEER_IMAGE_DRAWS = 20;

/** How long a peer has to answer at all. */
const PEER_IMAGE_TIMEOUT_MS = 120000;

/**
 * How long the transfer may go with no bytes arriving.
 *
 * PEER_IMAGE_TIMEOUT_MS does NOT cover this and cannot be made to: axios settles
 * a stream request when the response HEADERS arrive, and its timer is spent by
 * then. A peer that answers and then goes quiet - a hostile one, or an ordinary
 * NAT dropping the connection mid-archive - therefore left `docker load` waiting
 * on a body that never ended, so the shared acquisition promise never settled,
 * no retry was ever scheduled, the registry was never reached, and every file
 * operation on the node was refused until FluxOS restarted.
 *
 * Measured against arrival rather than total time, so a genuinely slow link
 * still finishes: the same reasoning as the upload rate floor, in the other
 * direction.
 */
const PEER_IMAGE_STALL_MS = 30000;

/**
 * The most this node will take from a peer before it has verified anything.
 *
 * Nothing is known about the bytes until they have all arrived, so this is what
 * stops a peer writing an unbounded amount into a node - a check that ran
 * afterwards ran too late.
 *
 * The pinned image saves to 5.9 MiB, so 32 MiB is over five times what an
 * honest archive weighs. It can be that tight because the image is pinned in
 * THIS repository: it cannot grow past the ceiling without a release that can
 * raise the ceiling with it, which would not be true of an image a node merely
 * pulled. And the failure is benign - a refused archive falls through to the
 * registry, so the operation is slower rather than lost.
 *
 * Read it as a RAM ceiling rather than a disk one. The archive goes to
 * os.tmpdir(), which is tmpfs on ArcaneOS and on any node whose systemd puts
 * /tmp there, and tmpfs pages are reclaimable only to swap. A CUMULUS has 8GB
 * for the node and every application on it, so what a peer can make it hold
 * matters more than the free space suggests. TMPDIR moves this onto disk and
 * needs no change here - os.tmpdir() reads it.
 */
const PEER_IMAGE_MAX_BYTES = 32 * 1024 * 1024;

/**
 * How many peers this node hands the image to at once.
 *
 * The archive is around thirteen megabytes and the endpoint answers anyone the
 * network state recognises, so without a ceiling a node can be asked to spend
 * its bandwidth by whoever asks most often.
 */
const PEER_IMAGE_SERVE_LIMIT = 4;

/**
 * How long a serve may go with the caller taking nothing.
 *
 * A slot came back only when the caller DISCONNECTED, and a caller that neither
 * disconnects nor reads does neither: the export simply blocks on backpressure
 * and the slot is held for as long as the socket is open. Two such connections
 * took every slot on a node until FluxOS restarted, and nothing said so - the
 * node's own operations kept working, so it looked healthy while quietly
 * serving no peer at all. Cheap to do to every node in the fleet at once, which
 * pushes all of them onto the registry: the load peer serving exists to avoid.
 *
 * Reachable by more than node operators, because an application's container
 * egresses under its host node's address.
 *
 * Measured against bytes taken rather than total time, so a slow but honest
 * caller still completes. The ingress side already reasons this way; this is the
 * same rule pointed the other direction, and there was no two-hour backstop
 * here as there is there.
 */
const PEER_IMAGE_SERVE_STALL_MS = 30000;

let peerImageServes = 0;

/**
 * How long the set of fleet addresses is reused for.
 *
 * Deciding whether a caller is a node meant copying the whole network state -
 * around 13,000 entries - and splitting a string per entry, BEFORE the caller
 * had been shown to be anyone. Measured at ~2.4ms of the event loop per
 * request, so roughly 400 requests a second saturate the one core FluxOS has
 * and stall everything else on it: app installs, operation polling, peer
 * messaging. The route is unauthenticated and the image id it needs is public
 * config, so that was reachable by anyone.
 *
 * A set is built once per window instead, however many callers arrive, which is
 * the same answer at a constant cost. Held only while the endpoint is being
 * used: nothing builds it on a node no peer ever asks.
 *
 * The convention this follows is already in the tree - the one other
 * unauthenticated route that walks the fleet list is wrapped in
 * `cache('30 seconds')`. A window is fine here for the same reason it is there:
 * a node that joined seconds ago can wait, and one that left is refused a
 * little late.
 */
const FLEET_ADDRESS_WINDOW_MS = 30000;

let fleetAddresses = null;
let fleetAddressesAt = 0;

/**
 * Whether an address belongs to a node in the fleet.
 *
 * By address rather than by socketAddress: a node's API port cannot be read off
 * an inbound connection, whose source port is ephemeral, and the fleet does not
 * all run on the default one.
 *
 * @param {string} remote
 * @returns {boolean}
 */
function fleetHolds(remote) {
  if (!fleetAddresses || monotonicMs() - fleetAddressesAt >= FLEET_ADDRESS_WINDOW_MS) {
    fleetAddresses = new Set(networkStateService.networkState().map((node) => bareIp(node.ip)));
    fleetAddressesAt = monotonicMs();
  }
  return fleetAddresses.has(remote);
}

/**
 * Take a peer's archive onto the disk, bounded, before anything reads it.
 *
 * To a file and not to memory: the ceiling has to be generous enough that an
 * honest archive is never refused, and holding that much heap on a node whose
 * memory is the constraint would trade one denial of service for another.
 *
 * Three things end the transfer: the ceiling, the stall window, and the caller
 * giving up. Each destroys the response, so a peer cannot hold the socket after
 * this returns, and the partial file is removed by the caller's finally.
 *
 * @param {NodeJS.ReadableStream} body - the peer's response
 * @param {string} destination - where to put it
 * @returns {Promise<number>} bytes taken
 */
async function receivePeerArchive(body, destination) {
  let taken = 0;
  let stalled = null;
  let failure = null;

  const sink = createWriteStream(destination);

  const stopWith = (error) => {
    failure = failure || error;
    body.destroy(error);
  };

  const watchdog = setInterval(function noticeSilence() {
    if (stalled === taken) {
      stopWith(new Error(`sent nothing for ${PEER_IMAGE_STALL_MS}ms`));
      return;
    }
    stalled = taken;
  }, PEER_IMAGE_STALL_MS);
  if (watchdog.unref) watchdog.unref();

  body.on('data', function count(chunk) {
    taken += chunk.length;
    if (taken > PEER_IMAGE_MAX_BYTES) {
      stopWith(new Error(`sent more than ${PEER_IMAGE_MAX_BYTES} bytes`));
    }
  });

  try {
    await new Promise((resolve, reject) => {
      pipeline(body, sink, (error) => (error || failure ? reject(failure || error) : resolve()));
    });
  } finally {
    clearInterval(watchdog);
  }

  return taken;
}

/**
 * Remove everything an archive brought that was not the image being fetched.
 *
 * A peer answers with a tar of its own making. The wanted id is kept and
 * everything else goes - extra images are not free, and one carrying a name the
 * sender chose is worse than not free: nothing else on this node would ever
 * look at it again.
 *
 * A tag is resolved before it is removed, because an archive may perfectly well
 * deliver the wanted image WITH a tag on it, and removing that tag would delete
 * the image this just went and fetched. A tag that cannot be resolved is left
 * alone rather than guessed at.
 *
 * Best effort throughout: failing to tidy up is not a reason to fail an
 * acquisition that otherwise worked.
 *
 * @param {{ids: Array<string>, tags: Array<string>}} loaded
 * @param {string} expected - the id to keep
 * @param {string} socketAddress - the peer, for the log
 * @returns {Promise<void>}
 */
async function discardUnwantedImages(loaded, accepted, socketAddress) {
  const wanted = new Set(accepted);
  const unwanted = loaded.ids.filter((id) => !wanted.has(id));

  // eslint-disable-next-line no-restricted-syntax
  for (const tag of loaded.tags) {
    // eslint-disable-next-line no-await-in-loop
    const id = await dockerService.getImageId(tag).catch(() => null);
    if (id && !wanted.has(id)) unwanted.push(tag);
  }

  if (!unwanted.length) return;

  log.warn(`volumeExecutor - ${socketAddress} sent ${unwanted.length} image(s) that were not asked for; removing them`);
  fluxEventBus.publish('fileoperation:imageDiscarded', { peer: socketAddress, count: unwanted.length });
  // eslint-disable-next-line no-restricted-syntax
  for (const reference of unwanted) {
    // eslint-disable-next-line no-await-in-loop
    await dockerService.appDockerImageRemove(reference).catch(() => {});
  }
}

/**
 * Take the image from another Flux node.
 *
 * The registry is one place, and a node that cannot reach it has no file
 * browser at all - `mkdir` included, which used to be a local call. Every other
 * node that has ever run a file operation holds the same image, so the fleet is
 * the second place.
 *
 * A peer is not trusted for what it sends. The archive names itself, so the ids
 * the daemon reports loading are checked against the one this node is pinned to
 * and anything else is removed again rather than left on the disk.
 *
 * @param {string} expected - the image id this node must end up holding
 * @returns {Promise<{peer: string, asked: number}>} which peer provided it, and
 *   how many were asked to get there
 * @throws {Error} if no peer provided it
 */
async function fetchImageFromPeer(expected) {
  const asked = new Set();
  const localAddress = await fluxNetworkHelper.getLocalSocketAddress().catch(() => null);

  // Bounded by peers CONTACTED, not by draws. The draw is random, so counting
  // draws lets a repeat stand in for a peer: on a small fleet that is the
  // difference between asking the node that has the image and never reaching
  // it. The draw ceiling is what stops a fleet of one from looping.
  for (let draw = 0; asked.size < PEER_IMAGE_ATTEMPTS && draw < PEER_IMAGE_DRAWS; draw += 1) {
    // eslint-disable-next-line no-await-in-loop
    // This node's own address, so a draw cannot come back as itself. Every other
    // caller of this passes one; passing null never matched, so a node could
    // spend one of only four attempts asking itself for an image it has already
    // established it does not hold. Negligible across the fleet, one draw in
    // three on a three-node one.
    //
    // Not fatal if it cannot be determined - a draw that might waste an attempt
    // is better than no peer search at all.
    // eslint-disable-next-line no-await-in-loop
    const socketAddress = await networkStateService.getRandomSocketAddress(localAddress);
    if (!socketAddress || asked.has(socketAddress)) {
      // eslint-disable-next-line no-continue
      continue;
    }
    asked.add(socketAddress);

    // Through the shared parser rather than split on a colon. An address may be
    // ip, ip:port, an IPv4-mapped ::ffff:1.2.3.4 - which the serve side strips
    // for exactly this reason, so the shape occurs - or an IPv6 literal, and
    // splitting on the first colon reads the mapped form as an EMPTY host and
    // an IPv6 literal as its first group. The serve side takes care over this
    // and the fetch side did not; two halves of one feature disagreeing about
    // what an address is, is the trap.
    const ip = bareIp(socketAddress);
    const port = extractPort(socketAddress);
    // A literal has to be bracketed to sit in a URL at all.
    const host = ip && ip.includes(':') ? `[${ip}]` : ip;
    let archiveDir = null;
    let archivePath = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await serviceHelper.axiosGet(
        `http://${host}:${port}/apps/fileoperationimage/${expected}`,
        { responseType: 'stream', timeout: PEER_IMAGE_TIMEOUT_MS },
      );
      // Out of memory first, bounded and with a stall window, so an archive
      // this node knows nothing about cannot be unbounded in size or in time.
      //
      // Into a directory of its own rather than loose in a shared one:
      // os.tmpdir() is world-writable and holds everything else on the box, and
      // this is an untrusted peer's bytes. mkdtemp creates it 0700 and creates
      // it atomically, so nothing else can be sitting at the name first.
      //
      // The base is created if it is missing, which is what lets a deployment
      // point TMPDIR at a path of its own - on ArcaneOS, at a directory on /dat
      // rather than the tmpfs /tmp is - without having to create it in the same
      // change, or at all.
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(os.tmpdir(), { recursive: true }).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      archiveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-op-image-'));
      archivePath = path.join(archiveDir, 'image.tar');
      // eslint-disable-next-line no-await-in-loop
      await receivePeerArchive(response.data, archivePath);

      // And looked at before the daemon is allowed near it. `docker load`
      // APPLIES the names an archive declares, which moves them off whatever
      // this node had under them - so a peer could rename this node's own app
      // images by packing their names in, and the cleanup afterwards removes
      // the stolen name rather than giving it back. This node's own serve path
      // exports by id and so declares no names at all; an archive that declares
      // any is doing something we never do, and is refused rather than
      // repaired.
      // eslint-disable-next-line no-await-in-loop
      const declared = await dockerService.archiveNames(archivePath);
      if (declared.length) {
        throw new Error(`archive names ${declared.join(', ')}, which this node does not accept from a peer`);
      }

      // eslint-disable-next-line no-await-in-loop
      const loaded = await dockerService.loadImage(createReadStream(archivePath));
      // Whatever else came in the archive goes, whether or not the wanted image
      // was in it. Returning on success first - which is what this did - left a
      // peer able to put images of its choosing on this node permanently, since
      // nothing else ever looks at them.
      // eslint-disable-next-line no-await-in-loop
      await discardUnwantedImages(loaded, expectedImageIds(), socketAddress);

      // The identifier the archive actually delivered, which is the only one
      // this daemon can act on: a containerd store files the image under the
      // index digest and knows nothing about the config digest, so naming it by
      // the first pinned id 404s and leaves the image nameless - which is the
      // very state the naming exists to prevent.
      const matched = loaded.ids.find((id) => expectedImageIds().includes(id));
      if (matched) {
        // Named only now that the id has been checked, and after the discard
        // above, so the name goes on bytes this node has verified rather than
        // on the sender's claim about them. A peer serves the archive by id and
        // the daemon writes no names for a reference that carries none, so what
        // arrives is nameless - and a nameless image is a dangling one, which
        // the prune before every app install takes. Without this the node loses
        // the image it just fetched at the next install and asks a peer again,
        // forever, on exactly the nodes that took the peer path because they
        // cannot reach the registry.
        //
        // A failure here is not a failure of the fetch: the image is present
        // and usable, it is only unprotected from the prune, which is where
        // this path stood before.
        // eslint-disable-next-line no-await-in-loop
        await dockerService.tagImage(matched, settings().image).catch((error) => {
          log.warn(`volumeExecutor - the file operation image could not be named, so a prune will take it: ${error.message}`);
        });
        log.info(`volumeExecutor - took the file operation image from ${socketAddress}`);
        return { peer: socketAddress, asked: asked.size };
      }

      log.warn(`volumeExecutor - ${socketAddress} sent ${loaded.ids.length} image(s), none of them ${expected}`);
    } catch (error) {
      log.warn(`volumeExecutor - ${socketAddress} could not provide the file operation image: ${error.message}`);
    } finally {
      // Whatever ended the transfer, the directory and the partial file in it
      // go: a peer that dies mid-archive must not leave this node accumulating
      // debris nothing will ever look at again. The directory rather than the
      // file, so nothing is left behind if the name inside it ever changes.
      if (archiveDir) {
        // eslint-disable-next-line no-await-in-loop
        await fs.rm(archiveDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  return { peer: null, asked: asked.size };
}

/**
 * Hand the image to another Flux node that cannot reach the registry.
 *
 * Narrow on purpose. The caller names the id it wants and gets it only if that
 * is the id THIS node is pinned to, so there is no "send me image X" here and
 * it cannot become one: a node of another architecture asks for an id this one
 * does not have and is refused, which is the right answer rather than a case to
 * handle. Only an address the network state recognises is answered, and only a
 * couple at a time.
 *
 * @param {object} req
 * @param {object} res
 * @returns {Promise<void>}
 */
async function serveImageToPeer(req, res) {
  let serving = false;

  try {
    // The remote address rather than a forwarded header: this answers other
    // nodes directly, and a header is written by whoever sends it.
    //
    // Only the IPv4-mapped prefix is stripped. Cutting to the LAST colon, which
    // is the usual spelling of this, turns 2001:db8::1 into "1" - so a genuine
    // IPv6 caller could never match the network state whatever it held, and the
    // 403 it received said nothing about why. Stripping just the prefix leaves
    // such an address intact to be compared as itself.
    const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/i, '');
    if (!remote) {
      res.status(400).end();
      return;
    }

    const asked = req.params.imageid;
    // Either identifier is a fair way to ask, because a caller names the image
    // by whatever ITS daemon files this image under, and that need not be what
    // ours does. Still only this image: the id is compared, never used to look
    // one up, so there is no "send me image X" here and there cannot become one.
    if (!expectedImageIds().includes(asked)) {
      res.status(404).end();
      return;
    }

    // HEAD reaches this handler too - express answers it from the GET route when
    // no HEAD route exists - and node discards the body of a HEAD response
    // without ever applying backpressure. So a HEAD cost this node a full
    // export, read off the disk and packed by docker, while costing the caller
    // one packet and no bandwidth at all. Nothing here has a body worth
    // describing, so there is nothing to answer.
    if (req.method === 'HEAD') {
      res.status(405).end();
      return;
    }

    // The ceiling before the fleet lookup, because it is a comparison and the
    // lookup is a set membership that may have to rebuild the set: a node with
    // no capacity should not pay to find out who is asking.
    //
    // Taken in the SAME TICK it is tested, before any await. Testing it, then
    // awaiting, then taking it - which is what this did - lets every request
    // that arrives together read the same count and all pass, so the ceiling
    // bounded nothing at exactly the moment it was needed.
    if (peerImageServes >= PEER_IMAGE_SERVE_LIMIT) {
      log.info(`volumeExecutor - refused ${remote} the file operation image: already serving ${peerImageServes}`);
      res.set('Retry-After', '30');
      res.status(503).end();
      return;
    }
    serving = true;
    peerImageServes += 1;

    if (!fleetHolds(remote)) {
      res.status(403).end();
      return;
    }

    // What THIS node holds it as, which is what it can export. A caller asking
    // under the other identifier still gets the same bytes, and checks them
    // against its own.
    const held = await heldImageId();
    if (!held) {
      res.status(404).end();
      return;
    }

    // Subscribed BEFORE the export, because the caller can hang up while docker
    // is still packing the archive. `close` fires once, so a listener attached
    // after it has already happened never sees it: the wait at the end would
    // never settle, the slot would never be given back, and two of those leave
    // this node serving no peer at all until FluxOS restarts - which pushes
    // everyone who asks it back onto the registry, the load peer serving exists
    // to avoid. Same reason collectOutput subscribes before the container
    // starts.
    let archive = null;
    let callerGone = false;
    let noteCallerGone = null;
    const disconnected = new Promise((resolve) => { noteCallerGone = resolve; });
    res.on('close', function callerWentAway() {
      callerGone = true;
      if (archive) archive.destroy();
      noteCallerGone();
    });

    archive = await dockerService.exportImage(held);
    if (callerGone) {
      // Nobody to send it to, and the export is this node's to close. Returning
      // here still gives the slot back, because that happens in the finally.
      archive.destroy();
      return;
    }

    res.set('Content-Type', 'application/x-tar');
    archive.on('error', function exportFailed() { res.destroy(); });

    // Bytes LEAVING the export, which is what a caller taking nothing stops:
    // pipe holds the archive against backpressure, so no data event fires while
    // the socket is not being drained. Counting them is therefore counting the
    // caller's progress, without needing anything from the socket.
    let sent = 0;
    let sentAtLastLook = null;
    archive.on('data', function count(chunk) { sent += chunk.length; });

    const watchdog = setInterval(function noticeIdleCaller() {
      if (sentAtLastLook === sent) {
        log.warn(`volumeExecutor - stopped serving the file operation image to ${remote}: took nothing for ${PEER_IMAGE_SERVE_STALL_MS}ms`);
        archive.destroy();
        res.destroy();
        noteCallerGone();
        return;
      }
      sentAtLastLook = sent;
    }, PEER_IMAGE_SERVE_STALL_MS);
    if (watchdog.unref) watchdog.unref();

    try {
      archive.pipe(res);
      await disconnected;
    } finally {
      clearInterval(watchdog);
    }
  } catch (error) {
    log.error(`volumeExecutor - could not hand over the file operation image: ${error.message}`);
    if (!res.headersSent) res.status(500).end();
  } finally {
    // Only the request that took a slot gives one back: an early refusal that
    // decremented would release somebody else's.
    if (serving) peerImageServes -= 1;
  }
}

/**
 * One attempt at getting the image: peers, then the registry if it is allowed.
 *
 * Peers first, everywhere. Once the fleet holds the image they are the faster
 * answer and they cost one central place nothing; a peer that does not have it
 * refuses at once rather than timing out, so asking is cheap even when it is
 * futile.
 *
 * @param {string} expected
 * @param {{registry: boolean}} sources
 * @returns {Promise<boolean>} whether the node now holds it
 */
async function acquisitionCycle(expected, sources) {
  const fromPeer = await fetchImageFromPeer(expected).catch((error) => {
    log.error(`volumeExecutor - the peer search failed: ${error.message}`);
    return { peer: null, asked: 0 };
  });
  if (!fromPeer.peer) {
    log.info(`volumeExecutor - no peer provided the file operation image: asked ${fromPeer.asked}`);
  }

  if (await heldImageId()) {
    // Where it came from, not just that it is here. The store is asked either
    // way, so "the node holds it" cannot tell a transfer that was read
    // correctly from one that was not - a peer whose archive was misread still
    // leaves the image on the disk, and the node goes on asking other peers for
    // something it already has. `unrecognised` is that case, and is the only
    // way it is visible from outside.
    fluxEventBus.publish('fileoperation:imageAcquired', fromPeer.peer
      ? { source: 'peer', peer: fromPeer.peer, asked: fromPeer.asked }
      : { source: 'unrecognised', asked: fromPeer.asked });
    return true;
  }

  if (!sources.registry) return false;

  const { image } = settings();
  for (let attempt = 0; attempt < REGISTRY_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await dockerService.pullImage({ repoTag: image });
      // A pull can end on an error event and still call back without one, so
      // the store is asked rather than the pull taken at its word.
      // eslint-disable-next-line no-await-in-loop
      if (await heldImageId()) {
        // `asked` is peers asked, on every branch. It used to be re-used here for
        // registry attempts, so one key on one event meant two different things
        // and anything adding them up was adding different denominators - and
        // the peers this node asked first were invisible whenever the registry
        // won, which is most of the time.
        fluxEventBus.publish('fileoperation:imageAcquired', {
          source: 'registry', asked: fromPeer.asked, attempts: attempt + 1,
        });
        return true;
      }
      log.warn(`volumeExecutor - ${image} resolved to an image this node is not pinned to`);
      return false;
    } catch (error) {
      log.info(`volumeExecutor - the registry did not provide ${image}: ${error.message}`);
    }
    // eslint-disable-next-line no-await-in-loop
    if (attempt + 1 < REGISTRY_ATTEMPTS) await serviceHelper.delay(REGISTRY_RETRY_MS);
  }

  return false;
}

/**
 * Arm the next acquisition, replacing any already armed.
 *
 * The ONLY place this timer is set, as stopImagePrefetch is the only place it
 * is cleared. Two paths schedule one - the boot prefetch's wait before it asks
 * the registry, and the retry backoff - and nothing about either says they
 * cannot both be live.
 *
 * Today they cannot: startImagePrefetch returns early when a timer is already
 * armed, and acquireImage dedupes, so an operation arriving mid-prefetch joins
 * that round rather than racing it and cannot arm before the prefetch does. A
 * timer left referenced by nothing would survive stopImagePrefetch and fire on
 * a node that asked not to fetch, so this does not rest on either of those
 * holding: there is one way to arm, and it clears what is already armed.
 *
 * @param {string} expected
 * @param {number} wait
 * @returns {void}
 */
function armAcquire(expected, wait) {
  if (acquireTimer) clearTimeout(acquireTimer);
  // eslint-disable-next-line no-use-before-define
  acquireTimer = setTimeout(() => { acquireImage(expected, { registry: true, thenRetry: true }); }, wait);
  if (acquireTimer.unref) acquireTimer.unref();
}

/**
 * Try again later, doubling the wait to a ceiling and jittered so nodes that
 * failed together do not return together.
 *
 * @param {string} expected
 * @returns {void}
 */
function scheduleAcquisition(expected) {
  backoffMs = backoffMs
    ? Math.min(backoffMs * 2, ACQUIRE_BACKOFF_CEILING_MS)
    : ACQUIRE_BACKOFF_MS;
  const wait = Math.round(backoffMs * (0.8 + (crypto.randomInt(0, 400) / 1000)));
  backoffUntil = monotonicMs() + wait;

  armAcquire(expected, wait);
}

/**
 * Run a cycle, sharing one between everything waiting on it, and decide what
 * happens when it comes back empty.
 *
 * @param {string} expected
 * @param {{registry: boolean, thenRetry: boolean}} options
 * @returns {Promise<boolean>}
 */
function acquireImage(expected, options) {
  // Sharing a round is right when it is looking where this caller needs it to.
  // It is not when the round in flight is the prefetch's peers-only one and the
  // caller was allowed the registry: joining it inherited a refusal from
  // sources that were never tried, and since the round was also `thenRetry:
  // false`, nothing was scheduled afterwards either. The caller was simply told
  // no while the source that would have answered went unasked - and the window
  // is not short, since four peers that blackhole take minutes.
  if (acquiring && (acquiringUsedRegistry || !options.registry)) return acquiring;

  if (acquiring) {
    return acquiring.then((held) => (held ? true : acquireImage(expected, options)));
  }

  acquiringUsedRegistry = options.registry;

  // Only a round that was allowed every source can say the search failed. The
  // prefetch's first round asks peers alone, so it has learned nothing about
  // the registry - and recording it as a failure would make it answer for one,
  // silencing callers for a minute over a source that was never tried. On a
  // cold fleet, where no peer holds the image either, that is every operation
  // on the node while the prefetch's own registry attempt is still hours away.
  const searched = (at) => { if (options.registry) failedAt = at; };

  acquiring = acquisitionCycle(expected, options)
    .then((held) => {
      if (held) {
        failedAt = 0;
        backoffMs = 0;
        backoffUntil = 0;
        log.info('volumeExecutor - the file operation image is on this node');
        return true;
      }
      searched(monotonicMs());
      if (options.thenRetry) scheduleAcquisition(expected);
      return false;
    })
    .catch((error) => {
      searched(monotonicMs());
      log.error(`volumeExecutor - could not fetch the file operation image: ${error.message}`);
      if (options.thenRetry) scheduleAcquisition(expected);
      return false;
    })
    .finally(() => { acquiring = null; });

  return acquiring;
}

/**
 * Take the image before anything asks for it.
 *
 * Peers immediately, because once the fleet holds the image that is the whole
 * job and it costs nobody anything - a node that reboots into a fleet that has
 * it is done in a moment. Only when no peer has it does this node need the
 * registry, and that is the fetch worth spreading, so it waits for its own
 * point in the window before going there.
 *
 * @returns {Promise<void>}
 */
async function prefetchImage() {
  const [expected] = expectedImageIds();
  if (await heldImageId()) return;

  await acquireImage(expected, { registry: false, thenRetry: false });
  if (await heldImageId()) return;

  const wait = prefetchDelayMs();
  log.info(`volumeExecutor - no peer had the file operation image; the registry will be asked in ${Math.round(wait / 60000)} minute(s)`);
  armAcquire(expected, wait);
}

/**
 * Start this node's fetch.
 *
 * Returns the first attempt so a caller can wait for it. Nothing in the boot
 * path does - it is deliberately not awaited there - but a test that asserts
 * what was scheduled has to know the scheduling has happened.
 *
 * @returns {Promise<void>}
 */
function startImagePrefetch() {
  if (acquireTimer) return Promise.resolve();
  return prefetchImage().catch((error) => {
    log.error(`volumeExecutor - could not start the image fetch: ${error.message}`);
  });
}

/**
 * Stop a scheduled fetch.
 * @returns {void}
 */
function stopImagePrefetch() {
  if (acquireTimer) clearTimeout(acquireTimer);
  acquireTimer = null;
  backoffMs = 0;
  backoffUntil = 0;
  failedAt = 0;
}

/**
 * Make sure the executor image is on this node.
 *
 * Creating a container does not pull - docker answers 404 for an image it does
 * not hold - so without this the first file operation on a node fails with an
 * opaque docker error, and so does every one after it.
 *
 * Checked before EVERY operation rather than once at startup, because nothing
 * guarantees the image is still there. An operator prunes, a disk fills, a
 * dockerd is replaced; the check is one inspect when it is present, so paying
 * it every time costs nothing and removes a whole class of "worked yesterday".
 *
 * `performDockerCleanup` is NOT one of the things that removes it, despite
 * running before every app install: `pruneImages` filters on dangling, and a
 * tagged image is not dangling. That holds for BOTH routes only because the
 * peer route names what it took - an archive addressed by id carries no names,
 * so an untagged arrival would be dangling and this would be false for exactly
 * the nodes that cannot reach the registry.
 *
 * A caller waits a short while and is then told to come back. It does not wait
 * for the fetch's own patience - a peer has two minutes to hand over thirteen
 * megabytes and nobody clicking a button has two minutes - and the fetch is not
 * abandoned because a caller stopped waiting. A cycle that has just failed
 * answers immediately, so a node that cannot get the image costs a click
 * milliseconds rather than minutes.
 *
 * @param {function(string): void} [onProgress]
 * @returns {Promise<string>} the id of the image to run
 */
async function ensureImage(onProgress = null) {
  // However it got here, and whichever identifier this daemon files it under.
  // An image carrying one of them is the image, whether it came from the
  // registry, from a peer, or was already on the node - and the one that
  // answered is the one the container is created from, because it is the only
  // one this daemon can resolve.
  const held = await heldImageId();
  if (held) return held;

  // How long this node will ACTUALLY refuse for, which is the longer of the two
  // things that make it refuse: the silence window it is inside, and whatever
  // the backoff has climbed to. Reporting only the backoff told a caller to come
  // back in the five-second floor while the node went on refusing for a minute,
  // so a client that honours the header retried about twelve times for nothing.
  const silenceLeft = () => (failedAt ? IMAGE_FAILURE_SILENCE_MS - (monotonicMs() - failedAt) : 0);
  const comeBackIn = () => Math.max(silenceLeft(), backoffUntil - monotonicMs());

  if (failedAt && monotonicMs() - failedAt < IMAGE_FAILURE_SILENCE_MS) {
    throw imageComing(comeBackIn());
  }

  if (onProgress) onProgress('Fetching the file operation image...');
  const [expected] = expectedImageIds();
  const cycle = acquireImage(expected, { registry: true, thenRetry: true });
  await Promise.race([cycle, serviceHelper.delay(IMAGE_WAIT_MS)]);

  const arrived = await heldImageId();
  if (arrived) return arrived;
  throw imageComing(comeBackIn());
}

/**
 * How much of a failed operation's own output is kept.
 *
 * Bounded because the output is produced inside the container and a runaway
 * command could otherwise fill this process's memory with it. The TAIL is kept
 * rather than the head: a tool that fails says why on its last line, after
 * however much routine chatter came first.
 */
const OUTPUT_TAIL_BYTES = 2000;

/**
 * The exit statuses flux-op uses to name a refusal, and what each means here.
 *
 * A status is the one part of a failure that does not depend on wording. The
 * commands that run inside the image are busybox's, and busybox words the same
 * condition differently from coreutils - so a caller reading the reason out of
 * the output would be matching on which build of a tool the image happens to
 * carry. Anything not listed is the command's own status, which says no more
 * than that it failed.
 */
const REFUSAL_BY_STATUS = new Map([
  [5, { code: 'EEXIST', message: 'Destination already exists' }],
  // flux-op refused because the only way to carry the request out was to delete
  // data it never named - a file put where a directory is, an entry moved onto
  // itself under another name. A distinct code so a caller answers it specifically
  // rather than as a generic failure.
  [6, { code: 'EDESTRUCTIVE', message: 'The destination could only be replaced by deleting data that was not part of this request' }],
]);

/**
 * The error a non-zero exit becomes.
 *
 * A named refusal keeps its code, because a caller acts on it: the dashboard
 * tells an app owner a folder is already there rather than that their request
 * failed. Everything else keeps the output, which is all there is to say.
 *
 * @param {number} status
 * @param {string} said - the tail of what the container wrote
 * @returns {Error}
 */
function failureFor(status, said) {
  const refusal = REFUSAL_BY_STATUS.get(status);
  if (refusal) {
    const error = new Error(refusal.message);
    error.code = refusal.code;
    return error;
  }
  return new Error(said
    ? `File operation failed (exit ${status}): ${said}`
    : `File operation failed with exit code ${status}`);
}

/**
 * Collect what the command writes, so a failure can say what went wrong.
 *
 * Without this, `AutoRemove` takes the container and its logs the moment it
 * exits and the caller is handed an exit code. "The archive is corrupt", "it
 * expands past the volume" and "it holds something that is not data" are three
 * different problems with three different answers, and they arrived as the same
 * number - to the user, and to whoever they then asked for help.
 *
 * Attached BEFORE start, for the same reason the exit subscription is: a fast
 * command can finish and be reaped before a later attach lands, and its output
 * is then gone.
 *
 * Never fatal. Losing the explanation is worse than an exit code alone, but
 * failing the operation over it would be worse still.
 *
 * @param {object} container - dockerode container
 * @returns {Promise<{text: string}>} filled in as the command writes
 */
async function collectOutput(container) {
  const captured = { text: '' };

  const sink = new Writable({
    write(chunk, encoding, callback) {
      captured.text = (captured.text + chunk.toString('utf8')).slice(-OUTPUT_TAIL_BYTES);
      callback();
    },
  });

  try {
    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    // stdout and stderr into one buffer: the caller wants to know what
    // happened, not which descriptor it arrived on.
    container.modem.demuxStream(stream, sink, sink);
  } catch (error) {
    log.warn(`volumeExecutor - could not capture operation output: ${error.message}`);
  }

  return captured;
}

/**
 * Bytes in use on a volume, from the filesystem itself.
 *
 * One syscall, whatever the tree looks like. The alternative - walking the
 * staging directory on every tick - costs 179ms per 20,000 files, which for an
 * app with 30,000 of them is a tenth of a core burned continuously to draw a
 * progress bar. Nothing else reports progress that way: rsync counts what it
 * writes because it does the writing, and we do not.
 *
 * Byte progress is readable here and nowhere else. Since coreutils 9.0 `cp`
 * copies with copy_file_range(2) - the kernel moves the bytes, so no counter on
 * the SOURCE side sees them: /proc/<pid>/io stays flat and the file offset in
 * /proc/<pid>/fdinfo does not advance until the end, which is why progress(1)
 * stopped working on cp. What the destination filesystem has consumed is a
 * different question, and it answers steadily the whole way through.
 *
 * It counts everything written to the volume, not only this operation's share,
 * because the application keeps running throughout. That is the right figure
 * for how full a volume is getting and an approximate one for how far a copy
 * has got; the caller clamps it, and the figure a completed operation reports
 * is taken from what it actually published rather than from here.
 *
 * @param {string} mount - host path of the app volume
 * @param {object} fsPromises
 * @returns {Promise<number|null>} bytes in use, or null if it cannot be read
 */
async function volumeUsedBytes(mount, fsPromises) {
  const stats = await fsPromises.statfs(mount).catch(() => null);
  if (!stats) return null;
  return (Number(stats.blocks) - Number(stats.bfree)) * Number(stats.bsize);
}

/**
 * The container an operation runs in.
 *
 * Containment comes from the container having nowhere to escape TO, rather than
 * from a sequence of path checks being correct:
 *
 *   the app's volume and nothing else   a path that escapes it lands nowhere
 *   ReadonlyRootfs                      writes outside the volume fail
 *   NetworkMode none                    a hostile archive cannot phone home
 *   no-new-privileges                   a setuid file cannot escalate
 *   CapDrop ALL + three                 see below
 *   pids and memory limits              bound a runaway archive
 *   AutoRemove                          no stopped container for a prune to find
 *
 * Three capabilities are added back out of docker's default fourteen. cp -a
 * cannot restore ownership without CAP_CHOWN and does not fail when it can't -
 * it exits 0 having written root-owned files, and an app running as a non-root
 * user then silently loses access to its own data. FOWNER and DAC_OVERRIDE are
 * needed to read and re-stamp files the container does not own. Everything else
 * stays dropped, including MKNOD, so an archive cannot create device nodes.
 */
function containerOptions(session, argv, image, workingDir = WORK_ROOT, withInput = false) {
  const { memoryBytes, pidsLimit } = settings();

  return {
    Image: image,
    Cmd: argv,
    WorkingDir: workingDir,
    Labels: { ...EXECUTOR_LABELS, 'runonflux.app': session.identifier },
    AttachStdout: true,
    AttachStderr: true,
    // Only an upload opens stdin. StdinOnce closes it once the attach that
    // wrote it disconnects, so the container cannot sit waiting on a descriptor
    // nobody holds any more.
    ...(withInput ? { OpenStdin: true, StdinOnce: true, AttachStdin: true } : {}),
    HostConfig: {
      Binds: [`${session.mount}:${WORK_ROOT}`],
      ReadonlyRootfs: true,
      NetworkMode: 'none',
      AutoRemove: true,
      CapDrop: ['ALL'],
      CapAdd: ['CHOWN', 'FOWNER', 'DAC_OVERRIDE'],
      SecurityOpt: ['no-new-privileges'],
      Memory: memoryBytes,
      PidsLimit: pidsLimit,
      // Docker's default seccomp and apparmor profiles apply because nothing
      // here disables them. Never pass seccomp=unconfined - it is the change
      // that gets made to "fix" a mystery permissions error and it removes the
      // syscall filter for every operation.
    },
  };
}

/**
 * Open the container's standard input.
 *
 * `hijack` gives a real duplex socket; without it the attach returns a
 * half-closed response stream and nothing can be written to the container at
 * all. Opened BEFORE the container starts, for the same reason the exit
 * subscription is: StdinOnce closes the descriptor once the attach that wrote it
 * disconnects, and a container that starts with nobody attached can reach that
 * point before the attach lands.
 *
 * @param {object} container - dockerode container, not yet started
 * @returns {Promise<object>} the duplex socket
 */
function attachInput(container) {
  return container.attach({
    stream: true, stdin: true, hijack: true,
  });
}

/**
 * Watch how the caller's stream ends, from before anything else is awaited.
 *
 * Subscribed immediately rather than when the pipe is set up, because an
 * `error` event with nobody listening is what node ends the PROCESS over - and
 * there is real time between receiving this stream and having a container to
 * feed it to, during which the client can disconnect.
 *
 * @param {import('node:stream').Readable} input
 * @returns {Promise<{complete: boolean, reason: string|null}>}
 */
function watchInput(input) {
  return new Promise((resolve) => {
    input.on('end', () => resolve({ complete: true, reason: null }));
    input.on('error', (error) => resolve({
      complete: false,
      reason: error.message || 'the connection ended early',
    }));
  });
}

/**
 * Count what arrives from the caller.
 *
 * The stall check reads the volume, which answers for a command writing into
 * staging and does not answer for an upload: what a client sends lands in
 * filesystem blocks, so a slow one moves nothing measurable for minutes and
 * reads as a container getting nowhere. Bytes arriving are the direct evidence
 * that something is happening, and they are exact where a block is rounded.
 *
 * Attached where the pipe is, not before: a `data` listener starts the stream
 * flowing, and one added before the destination exists loses what arrives in
 * between.
 *
 * @param {import('node:stream').Readable} input
 * @param {{bytes: number}} received - updated in place
 * @returns {void}
 */
function countInput(input, received) {
  input.on('data', (chunk) => {
    received.bytes += chunk.length;
  });
}

/**
 * Feed the caller's own bytes to a container that is writing them into staging,
 * and decide how the transfer ended.
 *
 * Three things here are load-bearing and none of them are obvious.
 *
 * The stream is piped with `end: false`, never through stream.pipeline. Pipeline
 * destroys its destination when the source errors, and destroying this socket is
 * indistinguishable to the container from the clean end-of-input that means "you
 * have everything". A browser that goes away mid-upload would look exactly like
 * one that finished, and half a file would be published as though it were whole.
 * Closing stdin is the only signal that the transfer completed, so it is sent
 * only when it did.
 *
 * An upload that did not complete stops the container instead. The command
 * cannot exit before its input closes, and flux-op cannot publish before the
 * command exits, so there is no race to lose: the stop always arrives first, and
 * flux-op reclaims staging on its way out.
 *
 * The pipe is raced against the container's exit because a container that has
 * stopped reading never drains the socket and never errors - measured, the
 * writer stalls at around 448KB and stays there indefinitely. Every refusal an
 * upload can produce arrives that way: too large, no space, a volume that filled
 * while it ran. Without the race each of them hangs the caller's request until
 * something else times it out.
 *
 * @param {object} stdin - the hijacked duplex socket from attachInput
 * @param {import('node:stream').Readable} input
 * @param {Promise<{complete: boolean, reason: string|null}>} transferred - from
 *   watchInput, subscribed before any of this was awaited
 * @param {Promise<object>} exited
 * @param {function(): void} stopContainer
 * @param {{bytes: number}} [received] - counted as it arrives, so a caller
 *   sending slowly is not mistaken for a container getting nowhere
 * @returns {Promise<{delivered: boolean, reason: string|null}>}
 */
async function feedContainer(stdin, input, transferred, exited, stopContainer, received = null) {
  input.pipe(stdin, { end: false });
  if (received) countInput(input, received);

  const ended = exited.then(() => 'exited', () => 'exited');
  const outcome = await Promise.race([transferred, ended]);

  if (outcome !== 'exited' && outcome.complete) {
    stdin.end();
    return { delivered: true, reason: null };
  }

  if (outcome !== 'exited') {
    stopContainer();
    stdin.destroy();
    return { delivered: false, reason: outcome.reason };
  }

  // The container gave up on its own - it has already decided, and its exit
  // status carries the reason.
  //
  // Unpiped, NOT destroyed. This stream belongs to the caller, and for an
  // upload it is the multipart parser's: destroying it stops the parser
  // consuming the request, so a client still sending cannot finish and can
  // never read the refusal it is being sent. The caller drains what remains.
  input.unpipe(stdin);
  stdin.destroy();
  return { delivered: false, reason: null };
}

/**
 * Run one file operation on an app's volume.
 *
 * @param {VolumeSession} session
 * @param {Array<string|VolumePath>} argv - operands must be VolumePath; a
 *   string operand is refused, which is what makes the session's checks
 *   unskippable rather than merely conventional
 * @param {object} [options]
 * @param {function(string): void} [options.onProgress] - called with each
 *   status line. The caller decides where it goes; for the HTTP endpoints that
 *   is jobRegistry.progress, so a client polls for the whole list rather than
 *   holding a connection open to receive it.
 * @param {function(): boolean} [options.isCanceled] - polled while the
 *   operation runs; when it returns true the container is killed. Cancellation
 *   is cooperative, so status stays Running until the work actually stops.
 * @param {string} [options.status] - the line reported while it runs
 * @param {function(number|null): void} [options.onBytes] - called with the bytes
 *   published so far, or null once measuring them stops being affordable. Only
 *   meaningful alongside `publish`, and only for operations that WRITE into
 *   staging: a move publishes the source where it stands, so its staging size is
 *   the whole operation from the first tick and says nothing about progress.
 *
 *   Called once more on success, with the size of what was actually published,
 *   so a finished operation reports what it finished rather than whichever tick
 *   completed last.
 * @param {{staging?: VolumePath, source?: VolumePath, destination: VolumePath}}
 *   [options.publish] - run the command into `staging` and move the result to
 *   `destination` only if it succeeds. Wrapping this here rather than leaving it
 *   to the caller is what stops an endpoint writing to a destination directly
 *   and losing the guarantee that a failure changes nothing.
 *
 *   Exactly one of `staging` and `source`. `staging` is scratch this operation
 *   created, so a failure may throw it away; `source` is the caller's own data,
 *   published where it stands, which is how a move is expressed - there is no
 *   command, because the source already IS the result. Naming them differently
 *   is what stops the discard applying to somebody's only copy: the difference
 *   has to be stated to be used, rather than remembered.
 * @param {boolean} [options.mkdirStaging] - create the staging directory first,
 *   for commands like `tar -C` that need it to exist. A file copy must NOT ask
 *   for it: cp -T refuses to overwrite a directory with a non-directory.
 * @param {number} [options.maxBytes] - ceiling on what the command may leave in
 *   staging. Enforced on the RESULT rather than on what the input claims about
 *   itself, because an archive's declared sizes are written by whoever built it.
 *   ZERO MEANS NO CEILING, here and in the image alike. An operation whose
 *   ceiling IS the volume's free space therefore has to establish that there is
 *   some before it asks - on a full volume the figure is zero, and the only
 *   bound it has would read as none. requireSpace and requireCapacity are how a
 *   caller does that.
 * @param {boolean} [options.dataOnly] - refuse a result holding a FIFO, a socket
 *   or a device node. None of them is data, and whatever opens a FIFO without
 *   O_NONBLOCK waits for a writer that never comes. Links are content and pass.
 * @param {boolean} [options.noReplace] - publish only onto a free name, and fail
 *   with EEXIST rather than replacing what is there. The refusal is the rename's
 *   own, so it answers for the instant nothing was written rather than for a
 *   look taken beforehand - the app is writing to this volume throughout.
 * @param {boolean} [options.merge] - overlay a directory result onto an existing
 *   directory at the destination rather than replacing it wholesale. Only acts
 *   when both are directories: a file over a file is still replaced, and a file
 *   over a directory (or the reverse) is refused either way. Without it a
 *   directory is never replaced wholesale, since that deletes every entry the
 *   caller did not name but that sat beside one they did.
 * @param {VolumePath} [options.workingDir] - the directory the command runs in,
 *   defaulting to the volume root. An archiver decides its stored layout from
 *   where it is run and what it is handed, and zip has no equivalent of tar's
 *   -C, so this is the only way to make the two agree.
 * @param {import('node:stream').Readable} [options.input] - the caller's own
 *   bytes, streamed into the container, which writes them into staging itself.
 *   There is no command on this path and that is the point of it: a command
 *   reading a stream cannot tell a truncated one from a complete one, so it
 *   would exit successfully on half a file. Requires `publish.staging`, and
 *   `maxBytes` is enforced as the bytes arrive rather than on what was left
 *   behind, because here we are the writer.
 * @param {boolean} [options.slotHeld] - the caller already holds this app's
 *   operation slot and will release it. For a request carrying several files:
 *   they are one operation from the caller's point of view, and taking a slot
 *   per file would refuse the second one.
 * @returns {Promise<void>} resolves when the operation succeeded
 */
async function run(session, argv, options = {}) {
  const {
    onProgress = null, isCanceled = null, status = 'Working...',
    publish = null, mkdirStaging = false, maxBytes = 0, dataOnly = false,
    noReplace = false, merge = false, onBytes = null, workingDir = null, input = null,
    slotHeld = false,
  } = options;

  if (!(session instanceof VolumeSession)) {
    throw new Error('run requires a VolumeSession');
  }

  if (workingDir && !(workingDir instanceof VolumePath)) {
    throw new Error('workingDir must be a VolumePath');
  }

  const toParam = (arg) => {
    if (arg instanceof VolumePath) return arg.containerPath;
    if (typeof arg !== 'string') throw new Error('Command arguments must be strings or VolumePath');
    // A string that looks like a host path never belongs in argv: operands are
    // expressed relative to the container's view of the volume, and a caller
    // passing an absolute path has bypassed the session.
    if (path.isAbsolute(arg) && !arg.startsWith(`${WORK_ROOT}/`) && arg !== WORK_ROOT) {
      throw new Error(`Refusing an absolute path operand outside ${WORK_ROOT}: ${arg}`);
    }
    return arg;
  };

  let params = argv.map(toParam);

  if (input) {
    if (!publish || !publish.staging) {
      throw new Error('input requires publishing through staging');
    }
    if (params.length) {
      throw new Error('input takes no command - flux-op writes the stream itself');
    }
  }

  if (publish) {
    if (Boolean(publish.staging) === Boolean(publish.source)) {
      throw new Error('publish requires exactly one of staging and source');
    }
    const target = publish.staging || publish.source;
    if (!(target instanceof VolumePath) || !(publish.destination instanceof VolumePath)) {
      throw new Error('publish requires VolumePath operands');
    }
    params = [
      'flux-op',
      // Names what an interrupted publish leaves behind, and where. Both are
      // given rather than derived from the operand: a move's operand is the
      // caller's own path at whatever depth they keep it, so a name derived
      // from it collides with what a user might call a folder, and a location
      // derived from it lands outside the one directory the sweep reads.
      '--id', crypto.randomUUID(),
      '--root', WORK_ROOT,
      ...(publish.staging ? ['--discard-staging'] : []),
      ...(mkdirStaging ? ['--mkdir'] : []),
      ...(maxBytes > 0 ? ['--max-bytes', String(Math.floor(maxBytes))] : []),
      ...(dataOnly ? ['--data-only'] : []),
      ...(noReplace ? ['--no-replace'] : []),
      ...(merge ? ['--merge'] : []),
      ...(input ? ['--from-stdin'] : []),
      toParam(target),
      toParam(publish.destination),
      '--',
      ...params,
    ];
  }

  // Before any await. The client can disconnect while the image is being
  // fetched or the container created, and an error event with no listener
  // ends the process.
  const transferred = input ? watchInput(input) : null;
  // What the caller has sent. The volume answers for a command writing into
  // staging; it does not answer for an upload, where a slow client moves no
  // whole block for minutes and reads as a container doing nothing.
  const received = { bytes: 0 };

  const release = slotHeld ? () => {} : acquireSlot(session.identifier);
  let container = null;
  let registeredContainerId = null;
  // Marked live so a restart mid-operation does not reap this container or sweep
  // this staging directory out from under it. A move or a rename publishes the
  // caller's own source rather than a staging directory, so there is nothing to
  // guard for those - only the operations that write into staging.
  const registeredStaging = publish && publish.staging ? publish.staging.hostPath : null;
  if (registeredStaging) liveStagingPaths.add(registeredStaging);
  let ticker = null;
  // Hoisted so the `finally` can reach them: everything this function opens is
  // closed there, and a handle declared inside the `try` is out of scope.
  let stdin = null;
  let exited = null;
  // The container's own exit has been observed, so it is reaping itself and
  // must not be stopped from here.
  let settled = false;
  // stop, not kill: this sends SIGTERM first and only escalates to SIGKILL
  // after the grace period. flux-op traps the TERM, stops the command and
  // reclaims its staging directory - a SIGKILL reaches neither, and the space
  // stays spent until the next boot sweep.
  const stopContainer = () => {
    if (!container) return;
    container.stop({ t: settings().cancelGraceSeconds }).catch(() => {});
  };
  let measuring = false;
  // Only scratch we created grows as the work proceeds. A move's operand is
  // whole from the first tick, so measuring it would report 100% throughout.
  let measurable = Boolean(onBytes && publish && publish.staging);
  const stopMeasuring = () => { measurable = false; };
  // What the volume held before this operation wrote anything.
  let baseline = null;
  // Liveness, kept separately from progress: the last figure the volume
  // reported and when it last CHANGED. A delete moves it down and a write moves
  // it up; either counts as the operation still doing something.
  let lastUsed = null;
  let lastChangeAt = process.hrtime.bigint();
  let stalled = false;
  let stallReason = null;
  // What the caller had sent when the current liveness window opened. Bytes are
  // measured against this as a RATE, because "has a byte arrived" is a question
  // one byte per window answers forever.
  let receivedAtWindowStart = 0;
  // Opened wherever progress is seen, so that the next window has to earn its
  // own. Kept together because a window that moved its clock without moving its
  // byte mark would measure the new window against the old one's total.
  const openLivenessWindow = () => {
    lastChangeAt = process.hrtime.bigint();
    receivedAtWindowStart = received.bytes;
  };
  // Closed once the final figure is in, so a read that started before the
  // operation ended cannot report over it.
  let reportsClosed = false;

  try {
    // Before the mount check, not after: fetching can take seconds, and the
    // mount is re-read immediately before the bind on purpose.
    // By id rather than by tag: the id is what was verified, and a tag is a
    // local name that anything with docker access can move.
    const image = await ensureImage(onProgress);
    await assertMountIsLive(session);

    container = await dockerService.createContainer(
      containerOptions(
        session,
        params,
        image,
        workingDir ? workingDir.containerPath : undefined,
        Boolean(input),
      ),
    );
    registeredContainerId = container.id;
    liveContainerIds.add(registeredContainerId);

    // Opened BEFORE start, and on next-exit rather than the default. The
    // default condition is "not-running", which a created container already
    // satisfies - so a naive wait-before-start returns 0 immediately. Asking
    // after start instead would race: a fast command can finish and be reaped
    // by AutoRemove before the request arrives, and the exit status is then
    // unknowable.
    exited = container.wait({ condition: 'next-exit' });
    const output = await collectOutput(container);
    stdin = input ? await attachInput(container) : null;

    try {
      await container.start();
    } catch (error) {
      // AutoRemove only fires for a container that RAN, so one that never
      // started stays on the node - stopped, invisible to the app sweeps
      // because it is correctly labelled as ours, and holding a reference to
      // the executor image that stops anything reclaiming it. Cleared so the
      // handler below does not then try to stop a container that is gone.
      await container.remove({ force: true }).catch(() => {});
      container = null;
      throw error;
    }

    if (onProgress) onProgress(status);

    // Everything the volume held before this operation wrote anything. Progress
    // is the difference from here, so the app's existing data is not counted as
    // this copy's work.
    if (measurable) baseline = await volumeUsedBytes(session.mount, fs);
    if (baseline === null) stopMeasuring();
    // Timed from here, not from when run() was entered: fetching the image can
    // take a minute on a cold node, and that is not the operation making no
    // progress.
    openLivenessWindow();

    // One timer serves four jobs: report that the operation is still alive,
    // notice a cancellation, read how far it has got, and notice that it has
    // stopped getting anywhere. A cancel only sets a flag - the work is not
    // interrupted where it stands - so something has to look, and this is
    // already looking.
    //
    // The read is async and the timer is not, so one still in flight when the
    // next tick arrives is skipped rather than stacked.
    const readVolume = () => {
      if (measuring) return;
      measuring = true;
      volumeUsedBytes(session.mount, fs)
        .then((used) => {
          if (used === null) return;
          if (used !== lastUsed) {
            lastUsed = used;
            openLivenessWindow();
          }
          if (reportsClosed || !measurable) return;
          // Never negative: the application is writing to this volume too, and
          // deleting something of its own would otherwise send a progress bar
          // backwards.
          onBytes(Math.max(0, used - baseline));
        })
        .catch(() => {})
        .finally(() => { measuring = false; });
    };

    ticker = setInterval(() => {
      if (isCanceled && isCanceled()) {
        log.info(`volumeExecutor - cancel requested, stopping ${session.identifier} operation`);
        stopContainer();
        return;
      }

      // Stopped because it is getting NOWHERE, not because it has taken a
      // while. A wall clock cannot tell a wedged container from a large copy:
      // moving 100 GB legitimately outruns any limit short enough to be useful,
      // and the 15 minutes this replaced was borrowed from the ceiling on short
      // shell commands. The volume's own usage is the honest signal, and it is
      // already being read - if it has not moved in either direction for this
      // long, nothing is happening.
      const { stallTimeoutMs, minUploadBitsPerSecond } = settings();
      const idleMs = Number(process.hrtime.bigint() - lastChangeAt) / 1e6;
      if (!stalled && stallTimeoutMs > 0 && idleMs > stallTimeoutMs) {
        // The volume has not moved for a whole window. For an upload that is
        // not yet an answer: a slow caller fills no whole filesystem block for
        // minutes, so the only evidence it is alive is the bytes it has sent -
        // asked as a rate over the window that just elapsed, never as "did any
        // byte arrive", which one byte per window satisfies until the request
        // itself times out hours later.
        //
        // Only for an operation with a caller attached. A copy or a move sends
        // nothing, so measuring it against a floor would stop every one of them
        // on the first window.
        const carried = received.bytes - receivedAtWindowStart;
        const floorBytes = (minUploadBitsPerSecond / 8) * (idleMs / 1000);
        if (input && carried >= floorBytes) {
          openLivenessWindow();
        } else {
          const seconds = Math.round(idleMs / 1000);
          stalled = true;
          stallReason = input
            ? `The upload sent ${carried} bytes in ${seconds}s, under the ${minUploadBitsPerSecond} bit/s a transfer has to keep`
            : 'File operation stopped after making no progress';
          log.error(`volumeExecutor - ${session.identifier} ${stallReason}; stopping it`);
          stopContainer();
          return;
        }
      }

      if (onProgress) onProgress(status);
      readVolume();
    }, settings().progressIntervalMs);

    // Started only once the ticker is running, so a transfer that stalls is
    // still subject to the same "has this got anywhere" check as everything
    // else - a client that opens an upload and then sends nothing holds a
    // container open otherwise.
    const transfer = input ? await feedContainer(stdin, input, transferred, exited, stopContainer, received) : null;

    const result = await exited;
    settled = true;
    if (stalled) {
      throw new Error(stallReason);
    }
    // An upload that did not arrive is not a failure of the operation - the
    // container did exactly what it was told. Reported as itself, because
    // "exit 143" tells the caller nothing about their own connection dropping.
    if (transfer && !transfer.delivered && transfer.reason) {
      throw new Error(`The upload did not complete: ${transfer.reason}`);
    }
    if (result.StatusCode !== 0) {
      throw failureFor(result.StatusCode, output.text.trim());
    }

    // The operation succeeded, so everything it was going to publish IS
    // published - and the running figure is whatever the last tick happened to
    // read, short of the truth by however much was written after it. Without a
    // final reading a completed copy reports some fraction of its own total and
    // stays there: the job says Succeeded while the bytes say 87%, which is the
    // one moment a progress figure is read most carefully.
    //
    // Measured at the DESTINATION, because that is where the result now is and
    // it is the only exact answer available: publishing is a rename, so staging
    // no longer exists, and the volume's own usage includes whatever the
    // application wrote alongside us. One walk, once, at the end.
    if (measurable) {
      if (ticker) {
        clearInterval(ticker);
        ticker = null;
      }
      // Closed BEFORE the measurement, not after: a read already in flight
      // would otherwise land between the two and report over the final figure.
      reportsClosed = true;
      stopMeasuring();

      // Occupied, because every other figure this progress bar is built from
      // is: the running one is the volume's own used-bytes, read through
      // statfs. A final reading in apparent bytes would make the bar jump at
      // the last tick - downwards, and by orders of magnitude for a tree of
      // small files - which is the very thing this reading exists to prevent.
      const published = await measureTree(publish.destination.hostPath, fs, { occupied: true })
        .catch(() => null);
      if (published !== null) onBytes(published);
    }
  } finally {
    if (ticker) clearInterval(ticker);
    // A walk still in flight when the operation ends must not report after it:
    // its figure is from part-way through, and landing it on a job already
    // marked Succeeded would show a finished copy stuck short of its total.
    stopMeasuring();
    // The hijacked socket to dockerd. feedContainer closes it on the paths it
    // owns, and destroy() is idempotent, so closing it here covers every other
    // way out at no cost to those.
    if (stdin) stdin.destroy();
    // An unsettled promise with no handler is what node ends the PROCESS over,
    // and a container can fail long after the wait was opened.
    if (exited) exited.catch(() => {});
    // Left running, it keeps writing to the volume with nobody waiting for it,
    // while the slot released below lets another operation start on the same
    // app. A container that has already exited reaps itself.
    if (container && !settled) stopContainer();
    if (registeredContainerId) liveContainerIds.delete(registeredContainerId);
    if (registeredStaging) liveStagingPaths.delete(registeredStaging);
    release();
  }
}

/**
 * Remove executor containers left running by a FluxOS restart.
 *
 * A container is detached from the process that started it, so a restart leaves
 * one running with nobody waiting for its result. Its staging directory is
 * reclaimed separately by sweepStagingDirectories; nothing it wrote is visible
 * at a destination path, because publishing is the last thing flux-op does.
 *
 * Selection is by LABEL, less what a live operation owns. This is the
 * ownership-scoped removal that replaced the blanket container prune: it removes
 * what FluxOS knows it started and is NOT still running, rather than everything
 * docker currently considers unused. The API answers before this runs, so a
 * container this process created moments ago is skipped by its id.
 *
 * @returns {Promise<number>} how many were removed
 */
async function reapOrphanedContainers() {
  let containers;
  try {
    containers = await dockerService.dockerListContainers(true);
  } catch (error) {
    log.error(`volumeExecutor - could not list containers to reap: ${error.message}`);
    return 0;
  }

  const orphans = (containers || []).filter(
    (container) => container.Labels
      && container.Labels['runonflux.role'] === 'fileop'
      && !liveContainerIds.has(container.Id),
  );

  let removed = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const orphan of orphans) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await dockerService.appDockerForceRemove(orphan.Id, false);
      removed += 1;
    } catch (error) {
      log.warn(`volumeExecutor - could not remove orphaned container ${orphan.Id}: ${error.message}`);
    }
  }
  if (removed) log.info(`volumeExecutor - reaped ${removed} orphaned file-operation container(s)`);
  return removed;
}

/**
 * Reclaim what an interrupted operation left on a volume.
 *
 * One kind of entry, and one rule. flux-op works in `.flux-op-<id>` and
 * publishes by exchanging it with the destination in a single atomic step, so a
 * crash lands on one side of that step or the other:
 *
 *   before   the destination is the caller's data, untouched, and the staging
 *            entry holds a result that was never published
 *   after    the destination is the result, and the staging entry holds the
 *            caller's superseded data
 *
 * In both, the destination is complete and the staging entry is disposable - so
 * this deletes staging entries and decides nothing else. It used to have to
 * decide: the publish was two renames, and between them the caller's only copy
 * sat under a second name with a marker beside it saying where it belonged.
 * Working out whether the second rename had happened meant comparing an inode
 * number and a timestamp, neither of which is unique, and the cost of being
 * wrong was deleting that copy.
 *
 * Matched against a real identifier shape rather than by prefix, and skipping any
 * a live operation is still writing into, because this DELETES what it matches in a
 * directory the app owner also writes to: `.flux-op-backups` is a name somebody may
 * legitimately have chosen, and a `.flux-op-<uuid>` an operation of this process
 * minted is one it still needs.
 *
 * On the host rather than in a container: the name came from readdir, so it is
 * one component with nothing to traverse, and `rm -rf` unlinks a symlink rather
 * than following it. That also means a node which cannot fetch the executor
 * image still reclaims its debris.
 *
 * @param {VolumeSession} session
 * @returns {Promise<{removed: Array<string>}>}
 */
async function sweepStagingDirectories(session) {
  const { mount } = session;
  const entries = await fs.readdir(mount).catch((error) => {
    log.warn(`volumeExecutor - could not read ${mount} to sweep: ${error.message}`);
    return null;
  });
  if (!entries) return { removed: [] };

  const removed = [];

  // On the host, and safe there: `name` came from readdir, so it is one
  // component with nothing to traverse, and `rm -rf` removes a symlink rather
  // than following it. It needs no container, so a node that cannot fetch the
  // executor image still reclaims its debris.
  const remove = async (name) => {
    const result = await serviceHelper.runCommand('rm', { runAsRoot: true, params: ['-rf', path.join(mount, name)] });
    if (result.error) throw result.error;
    removed.push(name);
  };

  // eslint-disable-next-line no-restricted-syntax
  for (const entry of entries) {
    try {
      if (isStagingName(entry) && !liveStagingPaths.has(path.join(mount, entry))) {
        // eslint-disable-next-line no-await-in-loop
        await remove(entry);
      }
    } catch (error) {
      log.warn(`volumeExecutor - could not sweep ${entry} in ${mount}: ${error.message}`);
    }
  }

  if (removed.length) {
    log.info(`volumeExecutor - swept ${removed.length} interrupted operation artefact(s) from ${mount}`);
  }
  return { removed };
}

module.exports = {
  run,
  ensureImage,
  serveImageToPeer,
  startImagePrefetch,
  stopImagePrefetch,
  assertCapacity,
  reapOrphanedContainers,
  sweepStagingDirectories,
  acquireSlot,
  EXECUTOR_LABELS,
};
