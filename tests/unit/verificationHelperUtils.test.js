const chai = require('chai');
const config = require('config');
const { ObjectId } = require('mongodb');
const proxyquire = require('proxyquire');
const expect = chai.expect;
let serviceHelper = require("../../ZelBack/src/services/serviceHelper");

const adminConfig = {
  initial: {
    ipaddress: '83.51.212.243',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    testnet: true
  }
}
const verificationHelperUtils = proxyquire('../../ZelBack/src/services/verificationHelperUtils',
  { '../../../config/userconfig': adminConfig });

const insertUsers = [{
  "_id": ObjectId("6108fbb9f04dfe1ef624b819"),
  "zelid": "1hjy4bCYBJr4mny4zCE85J94RXa8W6q37",  // regular user
  "loginPhrase": "162797868130153vt9r89dzjjjfg6kf34ntf1d8aa5zqlk04j3zy8z40ni",
  "signature": "H9oD/ZA7mEVQMWYWNIGDF7T2J++R/EG8tYPfB+fQ+XvQIbOXIcBEhxZwPYmh0HRj531oMc/HfcXPAYjWlN9wCn4="
}, {
  "_id": ObjectId("60cad0767247ac0a779fb3f0"),
  "zelid": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC", // admin
  "loginPhrase": "16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9",
  "signature": "IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc="
}, {
  "_id": ObjectId("620bbc40c04b4966674013a8"),
  "zelid": "1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBi9t", // app owner
  "loginPhrase": "1644935889016mtmbo4uah32tvvwrmzg4j8qzv04ba8g8n56cevn6b",
  "signature": "H4bL1HhNXiYiHywCnUeptHtLQY/YiGmLt14N+BBNXRIKd6BkP+kFr9CvaGLELQxN1A31OXoy3SMBoHj2/OqiK6c="
}, {
  "_id": ObjectId("61967125f3178f082a296100"),
  "zelid": "1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM",   // Flux team
  "loginPhrase": "1623904359736pja76q7y68deb4264olbml6o8gyhot2yvj5oevgv9k2",
  "signature": "H4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II="
}
];

const insertApp = {
  "_id": ObjectId("6147045cd774409b374d253d"),
  "name": "PolkadotNode",
  "description": "Polkadot is a heterogeneous multi-chain interchange.",
  "owner": "1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBi9t",
}

describe('verificationHelperUtils tests', () => {
  describe('verifyAdminSession tests', () => {
    beforeEach(async () => {
      await serviceHelper.initiateDB();
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(insertUsers);
    });

    it("should return true when requested by admin", async () => {
      const headers = {
        zelidauth: {
          zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc='
        }
      }

      const isAdmin = await verificationHelperUtils.verifyAdminSession(headers);

      expect(isAdmin).to.be.true;
    });

    it("should return false when requested by regular user", async () => {
      const headers = {
        zelidauth: {
          zelid: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
          signature: 'H9oD/ZA7mEVQMWYWNIGDF7T2J++R/EG8tYPfB+fQ+XvQIbOXIcBEhxZwPYmh0HRj531oMc/HfcXPAYjWlN9wCn4='
        }
      }

      const isAdmin = await verificationHelperUtils.verifyAdminSession(headers);

      expect(isAdmin).to.be.false;
    });

    it("should return false if signature is invalid", async () => {
      const headers = {
        zelidauth: {
          zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          signature: 'IH9d68fk/dYQtzMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc='
        }
      }

      const isAdmin = await verificationHelperUtils.verifyAdminSession(headers);

      expect(isAdmin).to.be.false;
    });

    it("should return false if zelID is invalid", async () => {
      const headers = {
        zelidauth: {
          zelid: '2CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc='
        }
      }

      const isAdmin = await verificationHelperUtils.verifyAdminSession(headers);

      expect(isAdmin).to.be.false;
    });

    it("should return false if header values are empty", async () => {
      const headers = {
        zelidauth: {
          zelid: '',
          signature: ''
        }
      }

      const isAdmin = await verificationHelperUtils.verifyAdminSession(headers);

      expect(isAdmin).to.be.false;
    });

    it("should return false if header is empty", async () => {
      const headers = {}

      const isAdmin = await verificationHelperUtils.verifyAdminSession(headers);

      expect(isAdmin).to.be.false;
    });
  });

  describe('verifyUserSession tests', () => {
    beforeEach(async () => {
      await serviceHelper.initiateDB();
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }


      await database.collection(collection).insertMany(insertUsers);
    });

    it("should return true when requested by a logged user", async () => {
      const headers = {
        zelidauth: {
          zelid: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
          signature: 'H9oD/ZA7mEVQMWYWNIGDF7T2J++R/EG8tYPfB+fQ+XvQIbOXIcBEhxZwPYmh0HRj531oMc/HfcXPAYjWlN9wCn4='
        }
      }

      const isLoggedUser = await verificationHelperUtils.verifyUserSession(headers);

      expect(isLoggedUser).to.be.true;
    });

    it("should return false if called with a wrong zelid", async () => {
      const headers = {
        zelidauth: {
          zelid: '1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBu9t',
          signature: 'IMDMG1GuDasjPMkrGaRQhkLpFO0saBV+v+N6h3wP6/QlF3J9ymLAPZy7DCBd/RnOSzUxmTHruenVeR7LghzRnHA='
        }
      }

      const isLoggedUser = await verificationHelperUtils.verifyUserSession(headers);

      expect(isLoggedUser).to.be.false;
    });

    it("should return false if called with a wrong signature", async () => {
      const headers = {
        zelidauth: {
          zelid: '1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBi9t',
          signature: 'IMDMG1GuDasjPMkrGaRQhkLpFO0saBZ+v+N6h3wP6/QlF3J9ymLAPZy7DCBd/RnOSzUxmTHruenVeR7LghzRnHA='
        }
      }

      const isLoggedUser = await verificationHelperUtils.verifyUserSession(headers);

      expect(isLoggedUser).to.be.false;
    });
    it("should return false if called with no header", async () => {
      const isLoggedUser = await verificationHelperUtils.verifyUserSession();

      expect(isLoggedUser).to.be.false;
    });

    it("should return false if called with empty data", async () => {
      const headers = {
        zelidauth: {
          zelid: '',
          signature: ''
        }
      }

      const isLoggedUser = await verificationHelperUtils.verifyUserSession(headers);

      expect(isLoggedUser).to.be.false;
    });
  });

  describe('verifyFluxTeamSession tests', () => {
    beforeEach(async () => {
      await serviceHelper.initiateDB();
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(insertUsers);
    });

    it("should return true when requested by the flux team", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'H4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };

      const isFluxTeamSession = await verificationHelperUtils.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.true;
    });

    it("should return false when zelid is not the flux team", async () => {
      const headers = {
        zelidauth: {
          zelid: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
          signature: 'H9oD/ZA7mEVQMWYWNIGDF7T2J++R/EG8tYPfB+fQ+XvQIbOXIcBEhxZwPYmh0HRj531oMc/HfcXPAYjWlN9wCn4='
        }
      };

      const isFluxTeamSession = await verificationHelperUtils.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.false;
    });


    it("should return false when signature is invalid", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'N4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };

      const isFluxTeamSession = await verificationHelperUtils.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.false;
    });

    it("should return false when zelid is invalid", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP1z5Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'H4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };

      const isFluxTeamSession = await verificationHelperUtils.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.false;
    });

    it("should return false when data is empty", async () => {
      const headers = {
        zelidauth: {
          zelid: '',
          signature: ''
        }
      };

      const isFluxTeamSession = await verificationHelperUtils.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.false;
    });

    it("should return false when data are true bools", async () => {
      const headers = {
        zelidauth: {
          zelid: true,
          signature: true
        }
      };

      const isFluxTeamSession = await verificationHelperUtils.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.false;
    });

    it("should return false when header is empty", async () => {
      const headers = {};

      const isFluxTeamSession = await verificationHelperUtils.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.false;
    });

    it("should return false when no header is passed", async () => {
      const isFluxTeamSession = await verificationHelperUtils.verifyFluxTeamSession();

      expect(isFluxTeamSession).to.be.false;
    });
  });

  describe('verifyAdminAndFluxTeamSession tests', () => {
    beforeEach(async () => {
      await serviceHelper.initiateDB();
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(insertUsers);
    });

    it("should return true when requested by the flux team", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'H4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };

      const isAdminOrFluxTeam = await verificationHelperUtils.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.true;
    });

    it("should return true when requested by the admin", async () => {
      const headers = {
        zelidauth: {
          zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc='
        }
      };

      const isAdminOrFluxTeam = await verificationHelperUtils.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.true;
    });

    it("should return false when zelid is not the flux team", async () => {
      const headers = {
        zelidauth: {
          zelid: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
          signature: 'H9oD/ZA7mEVQMWYWNIGDF7T2J++R/EG8tYPfB+fQ+XvQIbOXIcBEhxZwPYmh0HRj531oMc/HfcXPAYjWlN9wCn4='
        }
      };

      const isAdminOrFluxTeam = await verificationHelperUtils.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.false;
    });


    it("should return false when signature is invalid", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'N4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };

      const isAdminOrFluxTeam = await verificationHelperUtils.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.false;
    });

    it("should return false when zelid is invalid", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP1z5Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'H4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };

      const isAdminOrFluxTeam = await verificationHelperUtils.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.false;
    });

    it("should return false when data is empty", async () => {
      const headers = {
        zelidauth: {
          zelid: '',
          signature: ''
        }
      };

      const isAdminOrFluxTeam = await verificationHelperUtils.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.false;
    });

    it("should return false when data are true bools", async () => {
      const headers = {
        zelidauth: {
          zelid: true,
          signature: true
        }
      };

      const isAdminOrFluxTeam = await verificationHelperUtils.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.false;
    });

    it("should return false when header is empty", async () => {
      const headers = {};

      const isAdminOrFluxTeam = await verificationHelperUtils.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.false;
    });

    it("should return false when no header is passed", async () => {
      const isAdminOrFluxTeam = await verificationHelperUtils.verifyAdminAndFluxTeamSession();

      expect(isAdminOrFluxTeam).to.be.false;
    });
  });

  describe('verifyAppOwnerSession tests', () => {
    beforeEach(async () => {
      await serviceHelper.initiateDB();
      const db = serviceHelper.databaseConnection();
      const databaseLocal = db.db(config.database.local.database);
      const collectionLoggedUsers = config.database.local.collections.loggedUsers;

      try {
        await databaseLocal.collection(collectionLoggedUsers).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await databaseLocal.collection(collectionLoggedUsers).insertMany(insertUsers);


      const databaseGlobal = db.db(config.database.appsglobal.database);
      const collectionApps = config.database.appsglobal.collections.appsInformation;

      try {
        await databaseGlobal.collection(collectionApps).drop();
      } catch (err) {
        console.log('Collection not found.');
      }
      await serviceHelper.insertOneToDatabase(databaseGlobal, collectionApps, insertApp);

    });

    it("should return true when requested by the app owner", async () => {
      const headers = {
        zelidauth: {
          zelid: '1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBi9t',
          signature: 'H4bL1HhNXiYiHywCnUeptHtLQY/YiGmLt14N+BBNXRIKd6BkP+kFr9CvaGLELQxN1A31OXoy3SMBoHj2/OqiK6c='
        }
      };
      const appName = 'PolkadotNode';
      const isOwnerSession = await verificationHelperUtils.verifyAppOwnerSession(headers, appName);

      expect(isOwnerSession).to.be.true;
    });

    it("should return false when requested by the admin", async () => {
      const headers = {
        zelidauth: {
          zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc='
        }
      };
      const appName = 'PolkadotNode';
      const isOwnerSession = await verificationHelperUtils.verifyAppOwnerSession(headers, appName);

      expect(isOwnerSession).to.be.false;
    });

    it("should return false when requested by the owner with a wrong signature", async () => {
      const headers = {
        zelidauth: {
          zelid: '1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBi9t',
          signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc='
        }
      };
      const appName = 'PolkadotNode';
      const isOwnerSession = await verificationHelperUtils.verifyAppOwnerSession(headers, appName);

      expect(isOwnerSession).to.be.false;
    });

    it("should return false when requested with empty header data", async () => {
      const headers = {
        zelidauth: {
          zelid: '',
          signature: ''
        }
      };
      const appName = 'PolkadotNode';
      const isOwnerSession = await verificationHelperUtils.verifyAppOwnerSession(headers, appName);

      expect(isOwnerSession).to.be.false;
    });

    it("should return false when requested with empty header ", async () => {
      const headers = {};

      const appName = 'PolkadotNode';
      const isOwnerSession = await verificationHelperUtils.verifyAppOwnerSession(headers, appName);

      expect(isOwnerSession).to.be.false;
    });

    it("should return true when requested with an empty app name", async () => {
      const headers = {
        zelidauth: {
          zelid: '1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBi9t',
          signature: 'H4bL1HhNXiYiHywCnUeptHtLQY/YiGmLt14N+BBNXRIKd6BkP+kFr9CvaGLELQxN1A31OXoy3SMBoHj2/OqiK6c='
        }
      };
      const appName = '';
      const isOwnerSession = await verificationHelperUtils.verifyAppOwnerSession(headers, appName);

      expect(isOwnerSession).to.be.false;
    });
  });

  describe('verifyAppOwnerSessionOrHigher tests', () => {
    beforeEach(async () => {
      await serviceHelper.initiateDB();
      const db = serviceHelper.databaseConnection();
      const databaseLocal = db.db(config.database.local.database);
      const collectionLoggedUsers = config.database.local.collections.loggedUsers;

      try {
        await databaseLocal.collection(collectionLoggedUsers).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await databaseLocal.collection(collectionLoggedUsers).insertMany(insertUsers);

      const databaseGlobal = db.db(config.database.appsglobal.database);
      const collectionApps = config.database.appsglobal.collections.appsInformation;

      try {
        await databaseGlobal.collection(collectionApps).drop();
      } catch (err) {
        console.log('Collection not found.');
      }
      await serviceHelper.insertOneToDatabase(databaseGlobal, collectionApps, insertApp);

    });

    it("should return true when requested by the app owner", async () => {
      const headers = {
        zelidauth: {
          zelid: '1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBi9t',
          signature: 'H4bL1HhNXiYiHywCnUeptHtLQY/YiGmLt14N+BBNXRIKd6BkP+kFr9CvaGLELQxN1A31OXoy3SMBoHj2/OqiK6c='
        }
      };
      const appName = 'PolkadotNode';
      const isOwnerOrHigherSession = await verificationHelperUtils.verifyAppOwnerOrHigherSession(headers, appName);

      expect(isOwnerOrHigherSession).to.be.true;
    });

    it("should return true when requested by the admin", async () => {
      const headers = {
        zelidauth: {
          zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc='
        }
      };
      const appName = 'PolkadotNode';
      const isOwnerOrHigherSession = await verificationHelperUtils.verifyAppOwnerOrHigherSession(headers, appName);

      expect(isOwnerOrHigherSession).to.be.true;
    });

    it("should return true when requested by the flux team", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'H4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };
      const appName = 'PolkadotNode';
      const isOwnerOrHigherSession = await verificationHelperUtils.verifyAppOwnerOrHigherSession(headers, appName);

      expect(isOwnerOrHigherSession).to.be.true;
    });

    it("should return false when requested by a regular user", async () => {
      const headers = {
        zelidauth: {
          zelid: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
          signature: 'H9oD/ZA7mEVQMWYWNIGDF7T2J++R/EG8tYPfB+fQ+XvQIbOXIcBEhxZwPYmh0HRj531oMc/HfcXPAYjWlN9wCn4='
        }
      };
      const appName = 'PolkadotNode';
      const isOwnerOrHigherSession = await verificationHelperUtils.verifyAppOwnerOrHigherSession(headers, appName);

      expect(isOwnerOrHigherSession).to.be.false;
    });

    it("should return false when requested by the owner with a wrong signature", async () => {
      const headers = {
        zelidauth: {
          zelid: '1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBi9t',
          signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc='
        }
      };
      const appName = 'PolkadotNode';
      const isOwnerOrHigherSession = await verificationHelperUtils.verifyAppOwnerOrHigherSession(headers, appName);

      expect(isOwnerOrHigherSession).to.be.false;
    });

    it("should return false when requested with empty header data", async () => {
      const headers = {
        zelidauth: {
          zelid: '',
          signature: ''
        }
      };
      const appName = 'PolkadotNode';
      const isOwnerOrHigherSession = await verificationHelperUtils.verifyAppOwnerOrHigherSession(headers, appName);

      expect(isOwnerOrHigherSession).to.be.false;
    });

    it("should return false when requested with empty header ", async () => {
      const headers = {};

      const appName = 'PolkadotNode';
      const isOwnerOrHigherSession = await verificationHelperUtils.verifyAppOwnerOrHigherSession(headers, appName);

      expect(isOwnerOrHigherSession).to.be.false;
    });

    it("should return true when requested with an empty app name", async () => {
      const headers = {
        zelidauth: {
          zelid: '1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBi9t',
          signature: 'H4bL1HhNXiYiHywCnUeptHtLQY/YiGmLt14N+BBNXRIKd6BkP+kFr9CvaGLELQxN1A31OXoy3SMBoHj2/OqiK6c='
        }
      };
      const appName = '';
      const isOwnerOrHigherSession = await verificationHelperUtils.verifyAppOwnerOrHigherSession(headers, appName);

      expect(isOwnerOrHigherSession).to.be.false;
    });
  });
});
