const { expect } = require('chai');
const sinon = require('sinon');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const { nodeSigner } = require('../../ZelBack/src/services/utils/nodeSigner');

// The one place that asks whether this node can speak as itself. It exists
// because the answer used to be a value nobody checked: the key accessors
// returned the Error on failure, so pubKey could be an object that is truthy,
// is not a string, and becomes {} the moment it is stringified - and only two
// of nine callers looked. What went out was a message every peer refused, from
// a node that had logged nothing.
describe('nodeSigner', () => {
  const PUB = '04pubkey';
  const PRIV = 'Kwif';

  afterEach(() => sinon.restore());

  const keys = (pub, priv) => {
    sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').resolves(pub);
    sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey').resolves(priv);
  };

  it('signs as this node when it has both halves of its identity', async () => {
    keys(PUB, PRIV);
    sinon.stub(verificationHelper, 'signMessage').returns('a-signature');

    const signer = await nodeSigner();

    expect(signer.pubKey).to.equal(PUB);
    expect(signer.sign('anything')).to.equal('a-signature');
  });

  it('answers nothing when the public key is unavailable', async () => {
    keys(null, PRIV);

    expect(await nodeSigner()).to.equal(null);
  });

  it('answers nothing when the private key is unavailable', async () => {
    keys(PUB, undefined);

    expect(await nodeSigner()).to.equal(null);
  });

  // The shape that used to get through every guard: truthy, not a string, and
  // "pubKey":{} once JSON.stringify reaches it.
  it('answers nothing when a key comes back as an Error rather than a key', async () => {
    keys(new Error('daemon down'), PRIV);

    expect(await nodeSigner()).to.equal(null);
  });

  // A key this node holds is not a signature it produced.
  it('signs nothing when the signature itself fails', async () => {
    keys(PUB, PRIV);
    sinon.stub(verificationHelper, 'signMessage').returns(null);

    const signer = await nodeSigner();

    expect(signer).to.not.equal(null);
    expect(signer.sign('anything')).to.equal(null);
  });
});
