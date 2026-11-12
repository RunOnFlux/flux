const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();
const config = require('config');

describe('dosRecurrenceService tests', () => {
  let service;
  let nodeDosState;
  let height;
  let placementHolds;
  let stored;
  let heightListener;
  let afterRead;

  const copy = (value) => JSON.parse(JSON.stringify(value));

  function load() {
    nodeDosState = proxyquire('../../ZelBack/src/services/nodeDosState', {
      './utils/fluxEventBus': { publish: () => {} },
      '../lib/log': { error: () => {}, info: () => {}, warn: () => {} },
    });
    // Mongo's answers to a filtered upsert: a match replaces the record, no
    // record inserts one, and a record the filter misses refuses the insert
    // on its _id.
    const collection = {
      findOne: async () => {
        const read = stored ? copy(stored) : null;
        const write = afterRead;
        afterRead = null;
        if (write) write();
        return read;
      },
      updateOne: async (filter, update) => {
        let matches = Boolean(stored);
        if (stored && 'revision' in filter) {
          matches = typeof filter.revision === 'object'
            ? stored.revision === undefined
            : stored.revision === filter.revision;
        }
        if (stored && !matches) throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
        const upserted = !stored;
        stored = copy(update.$set);
        return { matchedCount: upserted ? 0 : 1, upsertedCount: upserted ? 1 : 0 };
      },
    };
    const daemonServiceMiscRpcs = {
      chainHeight: () => height,
      onDaemonHeight: (listener) => { heightListener = listener; return () => { heightListener = null; }; },
    };
    return proxyquire('../../ZelBack/src/services/dosRecurrenceService', {
      config: { database: { local: { database: 'local', collections: { dosRecurrence: 'dosrecurrence' } } }, dosRecurrence: config.dosRecurrence },
      '../lib/log': { error: () => {}, info: () => {}, warn: () => {} },
      './dbHelper': { databaseConnection: () => ({ db: () => ({ collection: () => collection }) }) },
      './nodeDosState': nodeDosState,
      './fluxNetworkHelper': {
        PlacementHoldOwner: { DOS_RECURRENCE: 'dosRecurrence' },
        isPolicyDosMessage: (message) => Boolean(message) && message.startsWith('Flux collision detection.'),
        setPlacementHold: (owner, reason) => { placementHolds.set(owner, reason); },
        clearPlacementHold: (owner) => { placementHolds.delete(owner); },
      },
      './utils/fluxEventBus': { publish: () => {}, snapshot: () => {} },
      './utils/blockWindowHolds': proxyquire('../../ZelBack/src/services/utils/blockWindowHolds', {
        '../daemonService/daemonServiceMiscRpcs': daemonServiceMiscRpcs,
      }),
    });
  }

  // One DOS episode from another check: in, then out of service.
  async function episode() {
    nodeDosState.setDos(100, 'Ports tested from outside failed. No answer over TCP: [49521].');
    await service.settled();
    nodeDosState.setDos(0, null);
    await service.settled();
  }

  async function advanceTo(newHeight) {
    height = newHeight;
    await heightListener(height);
  }

  const held = () => nodeDosState.isStickyDosHeldBy(nodeDosState.StickyDosOwner.DOS_RECURRENCE);
  const placementHeld = () => placementHolds.has('dosRecurrence');

  beforeEach(async () => {
    height = 1000;
    placementHolds = new Map();
    stored = null;
    afterRead = null;
    service = load();
    await service.start();
  });

  afterEach(async () => {
    await service.stop();
  });

  it('holds a node back from new apps for an hour after a first episode, and lets it go after', async () => {
    nodeDosState.setDos(100, 'Ports tested from outside failed. No answer over TCP: [49521].');
    await service.settled();
    expect(held(), 'one episode held the node out of service').to.equal(false);
    expect(placementHeld(), 'held placement while the node was still out of service').to.equal(false);

    nodeDosState.setDos(0, null);
    await service.settled();
    expect(placementHeld()).to.equal(true);

    await advanceTo(1000 + service.QUARANTINE_BLOCKS - 1);
    expect(placementHeld()).to.equal(true);
    await advanceTo(1000 + service.QUARANTINE_BLOCKS);
    expect(placementHeld()).to.equal(false);
  });

  it('holds the node out of service at a third episode in 24 hours, then quarantines it for six hours', async () => {
    await episode();
    await advanceTo(1200);
    await episode();
    await advanceTo(1400);
    nodeDosState.setDos(100, 'Ports tested from outside failed. No answer over TCP: [49521].');
    await service.settled();
    expect(held()).to.equal(true);

    // the check that went DOS clears, and the node stays out of service
    nodeDosState.setDos(0, null);
    expect(nodeDosState.isNodeDos()).to.equal(true);

    await advanceTo(1400 + service.SHORT_HOLD_BLOCKS - 1);
    expect(held()).to.equal(true);
    await advanceTo(1400 + service.SHORT_HOLD_BLOCKS);
    await service.settled();
    expect(held()).to.equal(false);
    expect(nodeDosState.isNodeDos()).to.equal(false);
    expect(placementHeld()).to.equal(true);
    expect(stored.placementHold.blocks).to.equal(service.HELD_QUARANTINE_BLOCKS);
  });

  it('holds the node out of service for 24 hours from the fourth episode', async () => {
    await episode();
    await episode();
    await episode();
    await advanceTo(1000 + service.SHORT_HOLD_BLOCKS);
    await service.settled();
    expect(held()).to.equal(false);

    nodeDosState.setDos(100, 'Ports tested from outside failed. No answer over TCP: [49521].');
    await service.settled();
    expect(held()).to.equal(true);
    expect(stored.dosHold.blocks).to.equal(service.LONG_HOLD_BLOCKS);
  });

  it('counts only the episodes inside the window', async () => {
    await episode();
    await episode();
    await advanceTo(1000 + service.WINDOW_BLOCKS);
    nodeDosState.setDos(100, 'Ports tested from outside failed. No answer over TCP: [49521].');
    await service.settled();
    expect(held(), 'episodes a day old counted toward the hold').to.equal(false);
    expect(stored.episodeHeights).to.deep.equal([1000 + service.WINDOW_BLOCKS]);
  });

  it('restores a hold across a restart, and does not count its own hold as an episode', async () => {
    await episode();
    await episode();
    nodeDosState.setDos(100, 'Ports tested from outside failed. No answer over TCP: [49521].');
    await service.settled();
    expect(held()).to.equal(true);
    await service.stop();

    service = load();
    await service.start();
    expect(held(), 'the hold did not survive the restart').to.equal(true);
    await service.stop();
    expect(stored.episodeHeights).to.have.lengthOf(3);
  });

  it('quarantines the node once a hold that outlived a restart ends', async () => {
    await episode();
    await episode();
    nodeDosState.setDos(100, 'Ports tested from outside failed. No answer over TCP: [49521].');
    await service.settled();
    await service.stop();

    service = load();
    await service.start();
    await service.settled();
    expect(held(), 'the hold did not survive the restart').to.equal(true);
    await advanceTo(1000 + service.SHORT_HOLD_BLOCKS);
    await service.settled();

    expect(held()).to.equal(false);
    expect(placementHeld()).to.equal(true);
    expect(stored.placementHold.blocks).to.equal(service.HELD_QUARANTINE_BLOCKS);
  });

  it('quarantines the node from its restart when an episode was open across it, and no later policy exit quarantines it again', async () => {
    nodeDosState.setDos(100, 'Ports tested from outside failed. No answer over TCP: [49521].');
    await service.settled();
    await service.stop();

    height = 1100;
    service = load();
    await service.start();
    expect(placementHeld(), 'the episode open across the restart got no quarantine').to.equal(true);
    expect(stored.awaitingExit).to.equal(false);
    expect(stored.placementHold).to.deep.equal({ fromHeight: 1100, blocks: service.QUARANTINE_BLOCKS });

    height = 1150;
    const { RESIDENTIAL_DOS } = nodeDosState.StickyDosOwner;
    nodeDosState.setStickyDos(RESIDENTIAL_DOS, 'residential node not running ArcaneOS');
    await service.settled();
    nodeDosState.clearStickyDos(RESIDENTIAL_DOS);
    await service.settled();
    expect(stored.placementHold).to.deep.equal({ fromHeight: 1100, blocks: service.QUARANTINE_BLOCKS });
    expect(stored.episodeHeights).to.deep.equal([1000]);
  });

  it('reads the record again when it changed after it was read, and stores the episode on top of the change', async () => {
    await service.settled();
    afterRead = () => {
      stored = {
        episodeHeights: [900], dosHold: null, placementHold: null, lastEpisodeHeld: false, awaitingExit: false, revision: 1,
      };
    };
    nodeDosState.setDos(100, 'Ports tested from outside failed. No answer over TCP: [49521].');
    await service.settled();

    expect(stored.episodeHeights).to.deep.equal([900, 1000]);
    expect(stored.revision).to.equal(2);
  });

  it('keeps a hold taken with no chain height until a height is known, and counts it from there', async () => {
    height = 0;
    await episode();
    await episode();
    nodeDosState.setDos(100, 'Ports tested from outside failed. No answer over TCP: [49521].');
    await service.settled();
    expect(held()).to.equal(true);
    expect(stored.dosHold.fromHeight).to.equal(null);

    await advanceTo(5000);
    await service.settled();
    expect(stored.dosHold.fromHeight).to.equal(5000);
    expect(stored.episodeHeights).to.deep.equal([5000, 5000, 5000]);
    await advanceTo(5000 + service.SHORT_HOLD_BLOCKS);
    await service.settled();
    expect(held()).to.equal(false);
  });
  it('counts no DOS a policy sets, and no quarantine follows it', async () => {
    const { RESIDENTIAL_DOS } = nodeDosState.StickyDosOwner;
    for (let i = 0; i < 4; i += 1) {
      nodeDosState.setStickyDos(RESIDENTIAL_DOS, 'residential node not running ArcaneOS');
      // eslint-disable-next-line no-await-in-loop
      await service.settled();
      nodeDosState.clearStickyDos(RESIDENTIAL_DOS);
      // eslint-disable-next-line no-await-in-loop
      await service.settled();
    }
    nodeDosState.setDos(100, 'Flux collision detection. Another ip:port is confirmed on flux network with the same collateral transaction information.');
    await service.settled();
    nodeDosState.setDos(0, null);
    await service.settled();

    expect(stored?.episodeHeights ?? []).to.deep.equal([]);
    expect(held()).to.equal(false);
    expect(placementHeld()).to.equal(false);
  });

  it('counts a failure a sticky owner holds the node out for', async () => {
    const { UPNP_ROUTER } = nodeDosState.StickyDosOwner;
    nodeDosState.setStickyDos(UPNP_ROUTER, 'router refuses the node');
    await service.settled();
    nodeDosState.clearStickyDos(UPNP_ROUTER);
    await service.settled();

    expect(stored.episodeHeights).to.deep.equal([1000]);
    expect(placementHeld()).to.equal(true);
  });
});
