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

  function load() {
    nodeDosState = proxyquire('../../ZelBack/src/services/nodeDosState', {
      './utils/fluxEventBus': { publish: () => {} },
      '../lib/log': { error: () => {}, info: () => {}, warn: () => {} },
    });
    const collection = {
      findOne: async () => (stored ? { ...stored } : null),
      updateOne: async (filter, update) => { stored = JSON.parse(JSON.stringify(update.$set)); },
    };
    return proxyquire('../../ZelBack/src/services/dosRecurrenceService', {
      config: { database: { local: { database: 'local', collections: { dosRecurrence: 'dosrecurrence' } } }, dosRecurrence: config.dosRecurrence },
      '../lib/log': { error: () => {}, info: () => {}, warn: () => {} },
      './dbHelper': { databaseConnection: () => ({ db: () => ({ collection: () => collection }) }) },
      './nodeDosState': nodeDosState,
      './fluxNetworkHelper': {
        PlacementHoldOwner: { DOS_RECURRENCE: 'dosRecurrence' },
        setPlacementHold: (owner, reason) => { placementHolds.set(owner, reason); },
        clearPlacementHold: (owner) => { placementHolds.delete(owner); },
      },
      './utils/fluxEventBus': { publish: () => {}, snapshot: () => {} },
      './daemonService/daemonServiceMiscRpcs': {
        chainHeight: () => height,
        onDaemonHeight: (listener) => { heightListener = listener; return () => { heightListener = null; }; },
      },
    });
  }

  // One DOS episode from another check: in, then out of service.
  async function episode() {
    nodeDosState.setDos(100, 'Ports tested not reachable from outside');
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
    service = load();
    await service.start();
  });

  afterEach(async () => {
    await service.stop();
  });

  it('holds a node back from new apps for an hour after a first episode, and lets it go after', async () => {
    nodeDosState.setDos(100, 'Ports tested not reachable from outside');
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
    nodeDosState.setDos(100, 'Ports tested not reachable from outside');
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

    nodeDosState.setDos(100, 'Ports tested not reachable from outside');
    await service.settled();
    expect(held()).to.equal(true);
    expect(stored.dosHold.blocks).to.equal(service.LONG_HOLD_BLOCKS);
  });

  it('counts only the episodes inside the window', async () => {
    await episode();
    await episode();
    await advanceTo(1000 + service.WINDOW_BLOCKS);
    nodeDosState.setDos(100, 'Ports tested not reachable from outside');
    await service.settled();
    expect(held(), 'episodes a day old counted toward the hold').to.equal(false);
    expect(stored.episodeHeights).to.deep.equal([1000 + service.WINDOW_BLOCKS]);
  });

  it('restores a hold across a restart, and does not count its own hold as an episode', async () => {
    await episode();
    await episode();
    nodeDosState.setDos(100, 'Ports tested not reachable from outside');
    await service.settled();
    expect(held()).to.equal(true);
    await service.stop();

    service = load();
    await service.start();
    expect(held(), 'the hold did not survive the restart').to.equal(true);
    await service.stop();
    expect(stored.episodeHeights).to.have.lengthOf(3);
  });

  it('keeps a hold taken with no chain height until a height is known, and counts it from there', async () => {
    height = 0;
    await episode();
    await episode();
    nodeDosState.setDos(100, 'Ports tested not reachable from outside');
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
});
