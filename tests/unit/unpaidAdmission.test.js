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

  // An app message in the order its admitting node signs it.
  const message = (fields = {}) => ({
    type: 'fluxappregister',
    version: 1,
    appSpecifications: { name: 'someapp' },
    hash: 'hash1',
    timestamp: 1793351626510,
    signature: 'ownersig',
    arcaneSender: true,
    ...fields,
  });
  const tagged = (fields = {}) => message({ clientTag: TAG, clientTagHeight: TAG_HEIGHT, ...fields });
  const originBy = (pubKey = ENTRY_KEY, fields = {}) => ({
    version: 1, timestamp: 1793351627000, pubKey, signature: `${pubKey}-sig`, ...fields,
  });
  const frameOf = (data, pubKey = ENTRY_KEY) => ({ ...originBy(pubKey), data });

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

  describe('admittedMessage', () => {
    it('is the fields an admitting node signs, in the order it signs them, and nothing else', () => {
      const { clientTag, ...rest } = tagged();

      const built = unpaidAdmission.admittedMessage({
        origin: originBy(), padding: 'x', clientTag, ...rest,
      });

      expect(Object.keys(built)).to.deep.equal([
        'type', 'version', 'appSpecifications', 'hash', 'timestamp', 'signature', 'arcaneSender', 'clientTag', 'clientTagHeight',
      ]);
      expect(JSON.stringify(built)).to.equal(JSON.stringify(tagged()));
    });
  });

  describe('admitUnpaid: a live announcement', () => {
    it('takes a tagged message under both allowances, keeping its admitting node\'s signature', async () => {
      const data = tagged();

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission).to.deep.equal({
        fields: {
          clientTag: TAG, clientTagHeight: TAG_HEIGHT, origin: originBy(), originKey: ENTRY_KEY,
        },
      });
      sinon.assert.notCalled(verifyBroadcasts);
    });

    it('keeps the signature and nothing else of the frame', async () => {
      const data = tagged();
      const frame = { ...frameOf(data), messageHashPresent: 'x' };

      const { fields } = await unpaidAdmission.admitUnpaid(data, { frame, daemonHeight: TIP });

      expect(fields.origin).to.have.all.keys('version', 'timestamp', 'pubKey', 'signature');
    });

    it('refuses a client that has used its allowance', async () => {
      holding({ clientTag: TAG }, 3);
      const data = tagged();

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'its client already has 3 unpaid app messages pending' });
    });

    it('does not count a client\'s paid messages against it', async () => {
      holding({ clientTag: TAG }, 3);
      paid = 1;
      const data = tagged();

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission.refused).to.equal(undefined);
      sinon.assert.calledWithExactly(dbHelper.countInDatabase, 'daemon', 'hashes', { hash: { $in: ['held0', 'held1', 'held2'] } });
    });

    it('refuses an operator that has used its allowance, whatever tags it gives', async () => {
      holding({ originKey: ENTRY_KEY }, 5);
      const data = tagged({ clientTag: OTHER_TAG });

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'its admitting operator already has 5 unpaid app messages pending' });
    });

    it('refuses a tagged frame carrying a field an app message does not have', async () => {
      const data = tagged({ padding: 'x'.repeat(64) });

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'it is not in the form its admitting node signs' });
    });

    it('refuses a tagged frame whose fields are not in the order its admitting node signs them', async () => {
      const { clientTag, ...rest } = tagged();
      const data = { clientTag, ...rest };

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'it is not in the form its admitting node signs' });
    });

    it('refuses a tagged frame whose timestamp is not a number', async () => {
      const data = tagged();
      const frame = { ...frameOf(data), timestamp: String(1793351627000).repeat(100) };

      const admission = await unpaidAdmission.admitUnpaid(data, { frame, daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'its admitting frame is malformed' });
    });

    it('refuses a tagged message whose arcaneSender is not a boolean', async () => {
      const data = tagged({ arcaneSender: 'x'.repeat(64) });

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'its arcaneSender is not a boolean' });
    });

    it('takes a live untagged frame whatever else it carries, storing no origin', async () => {
      const data = message({ padding: 'x'.repeat(64) });

      expect(await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP })).to.deep.equal({ fields: {} });
    });

    it('refuses a malformed tag and a tag height that is not current', async () => {
      const malformed = tagged({ clientTag: 'AB' });
      const stale = tagged({ clientTagHeight: TAG_HEIGHT - 240 });

      expect(await unpaidAdmission.admitUnpaid(malformed, { frame: frameOf(malformed), daemonHeight: TIP }))
        .to.deep.equal({ refused: 'its client tag is malformed' });
      expect(await unpaidAdmission.admitUnpaid(stale, { frame: frameOf(stale), daemonHeight: TIP }))
        .to.deep.equal({ refused: `its client tag height ${TAG_HEIGHT - 240} is not current` });
    });
  });

  describe('admitUnpaid: a reply rebuilt from storage', () => {
    it('checks the admitting node\'s signature over the message itself, as that node signed it', async () => {
      const origin = originBy();
      // the answering node signs the reply frame; the origin is the admitting node's
      const reply = tagged({ origin });

      const admission = await unpaidAdmission.admitUnpaid(reply, { frame: frameOf(reply, RELAY_KEY), daemonHeight: TIP });

      expect(admission).to.deep.equal({
        fields: {
          clientTag: TAG, clientTagHeight: TAG_HEIGHT, origin, originKey: ENTRY_KEY,
        },
      });
      sinon.assert.calledOnceWithExactly(verifyBroadcasts, [{ ...origin, data: tagged() }]);
    });

    it('checks the signature over the fields an admitting node signs, in its order, and no others', async () => {
      const origin = originBy();
      const { clientTag, ...rest } = tagged();
      const reply = { origin, padding: 'x', clientTag, ...rest };

      await unpaidAdmission.admitUnpaid(reply, { daemonHeight: TIP });

      const [[{ data }]] = verifyBroadcasts.firstCall.args;
      expect(JSON.stringify(data)).to.equal(JSON.stringify(tagged()));
    });

    it('takes a signature carried in a sync batch, which has no frame of its own', async () => {
      const admission = await unpaidAdmission.admitUnpaid(tagged({ origin: originBy() }), { daemonHeight: TIP });

      expect(admission.fields.originKey).to.equal(ENTRY_KEY);
    });

    it('refuses a signature that does not verify over the message - another tag, another message', async () => {
      verifyBroadcasts.resolves([{ result: VerifyResult.BAD_SIGNATURE }]);

      const admission = await unpaidAdmission.admitUnpaid(tagged({ clientTag: OTHER_TAG, origin: originBy() }), { daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'its origin does not verify (badSignature)' });
    });

    [
      ['a string', 'x'.repeat(64)],
      ['a timestamp that is not a number', originBy(ENTRY_KEY, { timestamp: 'x'.repeat(64) })],
      ['another frame version', originBy(ENTRY_KEY, { version: 2 })],
      ['an oversized signature', originBy(ENTRY_KEY, { signature: 'x'.repeat(101) })],
      ['an oversized key', originBy('x'.repeat(131))],
    ].forEach(([label, origin]) => {
      it(`refuses an origin that is ${label}, without checking a signature`, async () => {
        const admission = await unpaidAdmission.admitUnpaid(tagged({ origin }), { daemonHeight: TIP });

        expect(admission).to.deep.equal({ refused: 'its origin is malformed' });
        sinon.assert.notCalled(verifyBroadcasts);
      });
    });

    it('fails, rather than refusing, when the node list cannot be read', async () => {
      verifyBroadcasts.resolves([{ result: VerifyResult.UNREADABLE, reason: 'db down' }]);

      await unpaidAdmission.admitUnpaid(tagged({ origin: originBy() }), { daemonHeight: TIP }).then(
        () => expect.fail('should have failed'),
        (error) => expect(error.message).to.equal('The origin of hash1 could not be verified: db down'),
      );
    });

    it('refuses a tagged message that arrives with neither its admitting frame nor its signature', async () => {
      const admission = await unpaidAdmission.admitUnpaid(tagged(), { daemonHeight: TIP });

      expect(admission).to.deep.equal({ refused: 'it carries a client tag without the signature of the node that admitted it' });
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
