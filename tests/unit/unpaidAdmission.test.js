const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const { tagHeightIsCurrent } = require('../../ZelBack/src/services/utils/clientTag');

const TIP = 3081700;
const TAG_HEIGHT = 3081600;
const TAG = 'a'.repeat(64);
const OTHER_TAG = 'b'.repeat(64);
const ENTRY_KEY = '04entry';
const RELAY_KEY = '04relay';

const VerifyResult = Object.freeze({
  OK: 'ok', MALFORMED: 'malformed', BAD_SIGNATURE: 'badSignature', UNREADABLE: 'unreadable',
});

describe('unpaidAdmission tests', () => {
  let held;
  let paid;
  let dbHelper;
  let verifyBroadcasts;
  let clientTagFor;
  let getFluxNodePublicKey;
  let unpaidAdmission;

  const message = (fields = {}) => ({
    type: 'fluxappregister',
    version: 1,
    appSpecifications: { name: 'someapp' },
    hash: 'hash1',
    timestamp: 1793351626510,
    signature: 'ownersig',
    ...fields,
  });
  const frameOf = (data, pubKey = ENTRY_KEY) => ({
    version: 1, timestamp: 1793351627000, pubKey, signature: `${pubKey}-sig`, data,
  });

  beforeEach(() => {
    // what the temporary store holds per query, and how many of those hashes are paid
    held = new Map();
    paid = 0;
    dbHelper = {
      databaseConnection: sinon.stub().returns({ db: (name) => name }),
      findInDatabase: sinon.stub().callsFake(async (database, collection, query) => held.get(JSON.stringify(query)) ?? []),
      countInDatabase: sinon.stub().callsFake(async () => paid),
    };
    verifyBroadcasts = sinon.stub().resolves([{ result: VerifyResult.OK }]);
    clientTagFor = sinon.stub().resolves({ clientTag: TAG, clientTagHeight: TAG_HEIGHT });
    getFluxNodePublicKey = sinon.stub().resolves(ENTRY_KEY);
    unpaidAdmission = proxyquire('../../ZelBack/src/services/appMessaging/unpaidAdmission', {
      config: {
        database: { appsglobal: { database: 'appsglobal' }, daemon: { database: 'daemon' } },
        fluxapps: { clientTagCap: 3, originKeyCap: 5 },
      },
      '../dbHelper': dbHelper,
      '../fluxCommunicationUtils': { verifyBroadcasts, VerifyResult },
      '../fluxNetworkHelper': { getFluxNodePublicKey },
      '../utils/clientTag': { clientTagFor, tagHeightIsCurrent },
      '../utils/appConstants': { globalAppsTempMessages: 'temp', appsHashesCollection: 'hashes' },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  const holding = (query, count) => {
    held.set(JSON.stringify(query), Array.from({ length: count }, (_, i) => ({ hash: `held${i}` })));
  };

  describe('admitUnpaid: a live announcement', () => {
    it('takes a tagged message under both allowances, with its frame as its origin', async () => {
      const data = message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT });
      const frame = frameOf(data);

      const admission = await unpaidAdmission.admitUnpaid(data, { frame, daemonHeight: TIP });

      expect(admission).to.deep.equal({
        fields: {
          clientTag: TAG, clientTagHeight: TAG_HEIGHT, origin: JSON.stringify(frame), originKey: ENTRY_KEY,
        },
      });
      sinon.assert.notCalled(verifyBroadcasts);
    });

    it('stores only the signed fields of the frame', async () => {
      const data = message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT });
      const frame = { ...frameOf(data), messageHashPresent: 'x' };

      const { fields } = await unpaidAdmission.admitUnpaid(data, { frame, daemonHeight: TIP });

      expect(JSON.parse(fields.origin)).to.have.all.keys('version', 'timestamp', 'pubKey', 'signature', 'data');
    });

    it('refuses a client that has used its allowance', async () => {
      holding({ clientTag: TAG }, 3);
      const data = message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT });

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'its client already has 3 unpaid app messages pending' });
    });

    it('does not count a client\'s paid messages against it', async () => {
      holding({ clientTag: TAG }, 3);
      paid = 1;
      const data = message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT });

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission.refused).to.equal(undefined);
      sinon.assert.calledWithExactly(dbHelper.countInDatabase, 'daemon', 'hashes', { hash: { $in: ['held0', 'held1', 'held2'] } });
    });

    it('refuses an operator that has used its allowance, whatever tags it gives', async () => {
      holding({ originKey: ENTRY_KEY }, 5);
      const data = message({ clientTag: OTHER_TAG, clientTagHeight: TAG_HEIGHT });

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'its admitting operator already has 5 unpaid app messages pending' });
    });

    it('refuses a live frame carrying a field an app message does not have, before storing it as an origin', async () => {
      const data = message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT, padding: 'x'.repeat(64) });

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'its origin carries fields an app message does not have: padding' });
    });

    it('takes a live untagged frame whatever else it carries, storing no origin', async () => {
      const data = message({ padding: 'x'.repeat(64) });

      expect(await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP })).to.deep.equal({ fields: {} });
    });

    it('refuses a malformed tag and a tag height that is not current', async () => {
      const malformed = message({ clientTag: 'AB', clientTagHeight: TAG_HEIGHT });
      const stale = message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT - 240 });

      expect(await unpaidAdmission.admitUnpaid(malformed, { frame: frameOf(malformed), daemonHeight: TIP }))
        .to.deep.equal({ refused: 'its client tag is malformed' });
      expect(await unpaidAdmission.admitUnpaid(stale, { frame: frameOf(stale), daemonHeight: TIP }))
        .to.deep.equal({ refused: `its client tag height ${TAG_HEIGHT - 240} is not current` });
    });
  });

  describe('admitUnpaid: a reply rebuilt from storage', () => {
    it('takes the tag and operator from the origin it carries, not from the reply', async () => {
      const original = message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT });
      const origin = JSON.stringify(frameOf(original));
      // the answering node signs the reply, and could put any tag on it
      const reply = message({ clientTag: OTHER_TAG, clientTagHeight: TAG_HEIGHT, origin });

      const admission = await unpaidAdmission.admitUnpaid(reply, { frame: frameOf(reply, RELAY_KEY), daemonHeight: TIP });

      expect(admission).to.deep.equal({
        fields: {
          clientTag: TAG, clientTagHeight: TAG_HEIGHT, origin, originKey: ENTRY_KEY,
        },
      });
      sinon.assert.calledOnceWithExactly(verifyBroadcasts, [JSON.parse(origin)]);
    });

    it('takes an origin carried in a sync batch, which has no frame of its own', async () => {
      const original = message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT });
      const origin = JSON.stringify(frameOf(original));

      const admission = await unpaidAdmission.admitUnpaid(message({ origin }), { daemonHeight: TIP });

      expect(admission.fields.originKey).to.equal(ENTRY_KEY);
    });

    it('refuses an origin that does not verify', async () => {
      verifyBroadcasts.resolves([{ result: VerifyResult.BAD_SIGNATURE }]);
      const origin = JSON.stringify(frameOf(message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT })));

      const admission = await unpaidAdmission.admitUnpaid(message({ origin }), { daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'its origin does not verify (badSignature)' });
    });

    it('refuses an origin for another message', async () => {
      const origin = JSON.stringify(frameOf(message({ hash: 'hash2', clientTag: TAG, clientTagHeight: TAG_HEIGHT })));

      const admission = await unpaidAdmission.admitUnpaid(message({ origin }), { daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'its origin is for another message' });
      sinon.assert.notCalled(verifyBroadcasts);
    });

    it('refuses an origin that is not a frame', async () => {
      expect(await unpaidAdmission.admitUnpaid(message({ origin: '{not json' }), { daemonHeight: TIP }))
        .to.deep.equal({ refused: 'its origin is not a frame' });
      expect(await unpaidAdmission.admitUnpaid(message({ origin: { data: {} } }), { daemonHeight: TIP }))
        .to.deep.equal({ refused: 'its origin is not a frame' });
    });

    it('fails, rather than refusing, when the node list cannot be read', async () => {
      verifyBroadcasts.resolves([{ result: VerifyResult.UNREADABLE, reason: 'db down' }]);
      const origin = JSON.stringify(frameOf(message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT })));

      await unpaidAdmission.admitUnpaid(message({ origin }), { daemonHeight: TIP }).then(
        () => expect.fail('should have failed'),
        (error) => expect(error.message).to.equal('The origin of hash1 could not be verified: db down'),
      );
    });

    it('refuses an origin whose message carries a field an app message does not have', async () => {
      const origin = JSON.stringify(frameOf(message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT, padding: 'x'.repeat(64) })));

      const admission = await unpaidAdmission.admitUnpaid(message({ origin }), { daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'its origin carries fields an app message does not have: padding' });
    });

    it('takes an origin carrying every field an admitting node sets', async () => {
      const origin = JSON.stringify(frameOf(message({ arcaneSender: true, clientTag: TAG, clientTagHeight: TAG_HEIGHT })));

      const admission = await unpaidAdmission.admitUnpaid(message({ origin }), { daemonHeight: TIP });

      expect(admission.refused).to.equal(undefined);
    });

    it('refuses a tagged message that arrives without the frame that admitted it', async () => {
      const admission = await unpaidAdmission.admitUnpaid(message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT }), { daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'it carries a client tag without the frame that admitted it' });
    });
  });

  describe('admitUnpaid: a message without a tag', () => {
    it('takes it without counting anything, and stores nothing beside it', async () => {
      // its frame may be an old node's rebuilt reply, which names whoever answered
      const data = message();

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data, RELAY_KEY), daemonHeight: TIP });

      expect(admission).to.deep.equal({ fields: {} });
      sinon.assert.notCalled(dbHelper.findInDatabase);
    });

    it('takes it from an operator that has used its allowance for tagged messages', async () => {
      holding({ originKey: ENTRY_KEY }, 5);
      const data = message();

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission).to.deep.equal({ fields: {} });
    });
  });

  describe('tagSubmission', () => {
    const client = { remoteAddress: '198.51.100.25', headers: {} };

    it('gives the tag for a client under both allowances', async () => {
      expect(await unpaidAdmission.tagSubmission(client, TIP)).to.deep.equal({ clientTag: TAG, clientTagHeight: TAG_HEIGHT });
      sinon.assert.calledOnceWithExactly(clientTagFor, client, TIP);
    });

    it('refuses a client the network would refuse', async () => {
      holding({ clientTag: TAG }, 3);

      await unpaidAdmission.tagSubmission(client, TIP).then(
        () => expect.fail('should have refused'),
        (error) => expect(error.message).to.equal('The network will not take this app message: its client already has 3 unpaid app messages pending. Pending messages expire after an hour.'),
      );
    });

    it('refuses when this node\'s operator has used its allowance', async () => {
      holding({ originKey: ENTRY_KEY }, 5);

      await unpaidAdmission.tagSubmission(client, TIP).then(
        () => expect.fail('should have refused'),
        (error) => expect(error.message).to.include('its admitting operator already has 5'),
      );
    });
  });
});
