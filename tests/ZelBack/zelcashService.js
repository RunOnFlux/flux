const axios = require('axios');
const chai = require('chai');
const expect = chai.expect;

describe('ZelCash Service calls', () => {
  it('correctly communicates with ZelFlux and obtains data from a ZelCash service', () => {
    const data = {
      hexstring: '0400008085202f89010000000000000000000000000000000000000000000000000000000000000000ffffffff20037a4b0700324d696e6572732068747470733a2f2f326d696e6572732e636f6dffffffff04bf258e9e020000001976a91404e2699cec5f44280540fb752c7660aa3ba857cc88aca0118721000000001976a914c85ea3b8348d148b953b5c659f4f94c8998ffe2488ac601de137000000001976a914cb798afa21a56aab837459959e44ee7bc3c5691188ac80461c86000000001976a91404b74cfe29c810a5d49e8a7cdc0785e46fc4a8c588ac00000000000000000000000000000000000000',
    };
    axios.post('http://54.37.234.130:16127/zelcash/decoderawtransaction', JSON.stringify(data)).then((res) => {
      const expectation = '{"status":"success","data":{"txid":"01e3987803f7d74b3979799a764f1f5988c16457a800cd82e9d1cea15c17dfb1","overwintered":true,"version":4,"versiongroupid":"892f2085","locktime":0,"expiryheight":0,"vin":[{"coinbase":"037a4b0700324d696e6572732068747470733a2f2f326d696e6572732e636f6d","sequence":4294967295}],"vout":[{"value":112.50050495,"valueZat":11250050495,"n":0,"scriptPubKey":{"asm":"OP_DUP OP_HASH160 04e2699cec5f44280540fb752c7660aa3ba857cc OP_EQUALVERIFY OP_CHECKSIG","hex":"76a91404e2699cec5f44280540fb752c7660aa3ba857cc88ac","reqSigs":1,"type":"pubkeyhash","addresses":["t1JKRwXGfKTGfPV1z48rvoLyabk31z3xwHa"]}},{"value":5.625,"valueZat":562500000,"n":1,"scriptPubKey":{"asm":"OP_DUP OP_HASH160 c85ea3b8348d148b953b5c659f4f94c8998ffe24 OP_EQUALVERIFY OP_CHECKSIG","hex":"76a914c85ea3b8348d148b953b5c659f4f94c8998ffe2488ac","reqSigs":1,"type":"pubkeyhash","addresses":["t1c94XNVpBZdMEMMoGmoBhpD1EdEt1YQJDT"]}},{"value":9.375,"valueZat":937500000,"n":2,"scriptPubKey":{"asm":"OP_DUP OP_HASH160 cb798afa21a56aab837459959e44ee7bc3c56911 OP_EQUALVERIFY OP_CHECKSIG","hex":"76a914cb798afa21a56aab837459959e44ee7bc3c5691188ac","reqSigs":1,"type":"pubkeyhash","addresses":["t1cRUnDyJaUJujuyss5DgdfYwR4jAk7hp99"]}},{"value":22.5,"valueZat":2250000000,"n":3,"scriptPubKey":{"asm":"OP_DUP OP_HASH160 04b74cfe29c810a5d49e8a7cdc0785e46fc4a8c5 OP_EQUALVERIFY OP_CHECKSIG","hex":"76a91404b74cfe29c810a5d49e8a7cdc0785e46fc4a8c588ac","reqSigs":1,"type":"pubkeyhash","addresses":["t1JJYJ4aY83DR1kw9HwrxspB2gpfQRb4VtK"]}}],"vjoinsplit":[],"valueBalance":0,"vShieldedSpend":[],"vShieldedOutput":[]}}';
      expect(JSON.stringify(res.data)).to.equal(expectation);
    });
  });
});


