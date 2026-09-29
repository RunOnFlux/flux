const sinon = require('sinon');

const { IdentityVerdict } = require('../../ZelBack/src/services/peerIdentityService');

/**
 * A stand-in for peerIdentityService.verifyPeer, answered per address.
 *
 * An address nothing was said about answers UNVERIFIABLE - a peer that predates
 * the endpoint - which is the one verdict every caller treats exactly as it
 * treated every peer before identities existed. A suite about something else
 * therefore reads the same with this in place as it did without it.
 *
 * The verdicts are the module's own, so a value renamed there is renamed here.
 *
 * An address that introduced nothing has no introduction.
 *
 * @returns {object} `verifyPeer`, `introducedPeer`, the verdict names, and
 *   setters for one address.
 */
function makePeerIdentityDouble() {
  const byAddress = new Map();
  const introductions = new Map();
  const verifyPeer = sinon.stub().callsFake(async (address) => byAddress.get(address)
    ?? { verdict: IdentityVerdict.UNVERIFIABLE, reason: 'answered 404' });
  const introducedPeer = sinon.stub().callsFake((address) => introductions.get(address) ?? null);
  return {
    IdentityVerdict,
    verifyPeer,
    introducedPeer,
    introduced(address, identity = {}) {
      introductions.set(address, {
        socketAddress: address, pubKey: 'PUB', deviceId: null, ...identity,
      });
    },
    verified(address, identity = {}) {
      byAddress.set(address, {
        verdict: IdentityVerdict.VERIFIED,
        identity: {
          socketAddress: address, pubKey: 'PUB', deviceId: null, ...identity,
        },
      });
    },
    misrouted(address, answeredAs) {
      byAddress.set(address, { verdict: IdentityVerdict.MISROUTED, answeredAs });
    },
    unreachable(address) {
      byAddress.set(address, { verdict: IdentityVerdict.UNREACHABLE, reason: 'timeout of 10000ms exceeded' });
    },
    reset() {
      byAddress.clear();
      introductions.clear();
      verifyPeer.resetHistory();
      introducedPeer.resetHistory();
    },
  };
}

module.exports = { makePeerIdentityDouble };
