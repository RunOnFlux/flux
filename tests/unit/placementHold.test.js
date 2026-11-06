const { expect } = require('chai');
const placementHold = require('../../ZelBack/src/services/placementHold');

describe('placementHold tests', () => {
  const { RESIDENTIAL_DOS, HOST_STALL } = placementHold.PlacementHoldOwner;

  afterEach(() => {
    Object.values(placementHold.PlacementHoldOwner).forEach((owner) => placementHold.clearPlacementHold(owner));
  });

  it('is not held by default', () => {
    expect(placementHold.isPlacementHeld()).to.equal(false);
    expect(placementHold.getPlacementHold()).to.equal(null);
  });

  it('holds with the reason it was given', () => {
    placementHold.setPlacementHold(RESIDENTIAL_DOS, 'residential node not running ArcaneOS');

    expect(placementHold.isPlacementHeld()).to.equal(true);
    expect(placementHold.getPlacementHold()).to.equal('residential node not running ArcaneOS');
  });

  it('releases', () => {
    placementHold.setPlacementHold(RESIDENTIAL_DOS, 'some reason');

    placementHold.clearPlacementHold(RESIDENTIAL_DOS);

    expect(placementHold.isPlacementHeld()).to.equal(false);
  });

  it('refuses an owner it does not know, rather than minting one', () => {
    expect(() => placementHold.setPlacementHold('someFeature', 'a reason')).to.throw('unknown owner');
    expect(placementHold.isPlacementHeld()).to.equal(false);
  });

  it('does not release a hold it does not own', () => {
    placementHold.setPlacementHold(RESIDENTIAL_DOS, 'residential');

    placementHold.clearPlacementHold('someOtherOwner');

    expect(placementHold.isPlacementHeld()).to.equal(true);
    expect(placementHold.getPlacementHold()).to.equal('residential');
  });

  it('stays held until every owner has released, and reports every reason', () => {
    placementHold.setPlacementHold(RESIDENTIAL_DOS, 'residential');
    placementHold.setPlacementHold(HOST_STALL, 'stalled');

    expect(placementHold.getPlacementHold()).to.equal('residential; stalled');

    placementHold.clearPlacementHold(RESIDENTIAL_DOS);

    expect(placementHold.isPlacementHeld()).to.equal(true);
    expect(placementHold.getPlacementHold()).to.equal('stalled');
  });
});
