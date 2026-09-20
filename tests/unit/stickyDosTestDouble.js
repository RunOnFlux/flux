const sinon = require('sinon');

const { StickyDosOwner } = require('../../ZelBack/src/services/fluxNetworkHelper');

/**
 * An owner-keyed stand-in for the sticky DOS half of fluxNetworkHelper.
 *
 * Stateful, because the rules under test are written against reading back what
 * was written: a getter pinned to null lets a release that must not happen pass
 * as though it had. Keyed by owner for the same reason - a double holding a
 * single slot would accept a release from any caller, and so could never fail
 * the way the real module refuses to.
 *
 * The owners are the module's own, so a value renamed there is renamed here
 * rather than leaving a double that agrees with nothing.
 *
 * @returns {object} The stubbed surface, plus `holds` for seating another
 * owner's verdict and reading the result.
 */
function makeStickyDosDouble() {
  const holds = new Map();
  return {
    StickyDosOwner,
    setStickyDos: sinon.stub().callsFake((owner, reason) => {
      if (!Object.values(StickyDosOwner).includes(owner)) {
        throw new Error(`setStickyDos: unknown owner ${owner}`);
      }
      holds.set(owner, reason);
    }),
    clearStickyDos: sinon.stub().callsFake((owner) => { holds.delete(owner); }),
    isStickyDosHeldBy: sinon.stub().callsFake((owner) => holds.has(owner)),
    getStickyDosMessage: sinon.stub().callsFake(() => (holds.size ? [...holds.values()].join('; ') : null)),
    holds,
  };
}

module.exports = { makeStickyDosDouble };
