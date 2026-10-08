const sinon = require('sinon');

const { IdentityVerdict, AnswerPurpose } = require('../../ZelBack/src/services/peerIdentityService');

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
 * `askSigned` sends its question through `post` - the suite's own transport - and
 * judges the reply as the module does: a verified address's successful reply is
 * its signed answer, a misrouted address is not asked, and any other reply is
 * unproven, readable unsigned only from an address nothing proved.
 * `repliesUnsigned` makes a verified address's replies unproven.
 *
 * @param {{post?: Function}} [transport] What `askSigned` asks through.
 * @returns {object} `verifyPeer`, `askSigned`, `introducedPeer`, the verdict
 *   and purpose names, and setters for one address.
 */
function makePeerIdentityDouble({ post } = {}) {
  const byAddress = new Map();
  const introductions = new Map();
  const unsigned = new Set();
  const verifyPeer = sinon.stub().callsFake(async (address) => byAddress.get(address)
    ?? { verdict: IdentityVerdict.UNVERIFIABLE, reason: 'answered 404' });
  const introducedPeer = sinon.stub().callsFake((address) => introductions.get(address) ?? null);
  const askSigned = sinon.stub().callsFake(async (address, path, purpose, body = {}, options = {}) => {
    const said = byAddress.get(address);
    if (said?.verdict === IdentityVerdict.MISROUTED) return said;
    const unproven = (reply) => ({
      verdict: IdentityVerdict.UNVERIFIABLE,
      ...reply,
      mayReadUnsigned: !said || said.verdict === IdentityVerdict.UNVERIFIABLE,
    });
    const challenge = 'c'.repeat(32);
    const fields = typeof body === 'function' ? await body(challenge) : body;
    let response;
    try {
      response = await post(`http://${address.split(':')[0]}:${address.split(':')[1]}${path}`, { ...fields, challenge }, { timeout: options.timeout });
    } catch (error) {
      if (!error.response) return { verdict: IdentityVerdict.UNREACHABLE, reason: error.message };
      return unproven({ status: error.response.status, data: error.response.data });
    }
    if (said?.verdict === IdentityVerdict.VERIFIED && !unsigned.has(address)) {
      return { verdict: IdentityVerdict.VERIFIED, answer: response.data?.data };
    }
    return unproven({ status: response.status ?? 200, data: response.data });
  });
  return {
    IdentityVerdict,
    AnswerPurpose,
    verifyPeer,
    askSigned,
    introducedPeer,
    repliesUnsigned(address) {
      unsigned.add(address);
    },
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
      unsigned.clear();
      verifyPeer.resetHistory();
      askSigned.resetHistory();
      introducedPeer.resetHistory();
    },
  };
}

module.exports = { makePeerIdentityDouble };
