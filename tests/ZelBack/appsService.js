const appService = require("../../ZelBack/src/services/zelappsService");
const chai = require('chai');
const expect = chai.expect;

// describe('checkAndRequestZelApp', () => {
//   it('signs checks and requests app properly', async () => {
//     const zelapphash = 'abc';
//     const txid = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
//     const height = 33;
//     valueSat = 33 * 1e8;
//     const abc = await appService.checkAndRequestZelApp(zelapphash, txid, height, valueSat);
//     expect(abc).to.equal('abc');
//   });
// });