const helper = require("../../ZelBack/src/services/serviceHelper");
const chai = require('chai');
const expect = chai.expect;

describe('ZelFlux signer', () => {
  it('signs and verifies messages correctly', () => {
    const message = 'abc';
    const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
    const pubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const signature = helper.signMessage(message, privKey);
    console.log(signature);
    const verification = helper.verifyMessage(message, pubKey, signature);
    expect(verification).to.equal(true);
    const verification2 = helper.verifyMessage(message, 'abc', signature);
    expect(verification2).to.be.an('error');
    const signature2 = helper.signMessage(message, 'asd');
    expect(signature2).to.be.an('error');
    const verification3 = helper.verifyMessage(message, pubKey, 'kappa');
    expect(verification3).to.be.an('error');
    const verification4 = helper.verifyMessage(message, '1KoXq8mLxpNt3BSnNLq2HzKC39Ne2pVJtF', signature);
    expect(verification4).to.equal(true);
    const verification5 = helper.verifyMessage(message, '1KoXq8mLxpNt3BSnNLqd2HzKC39Ne2pVJtF', signature);
    expect(verification5).to.be.an('error');
    const verification6 = helper.verifyMessage(message, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', signature);
    expect(verification6).to.equal(false);
    const verification7 = helper.verifyMessage(message, '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', signature);
    expect(verification7).to.equal(false);
  });
});