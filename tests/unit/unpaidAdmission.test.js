const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const { tagHeightIsCurrent } = require('../../ZelBack/src/services/utils/clientTag');
const realAllowances = require('../../ZelBack/src/services/utils/unpaidAllowances');

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
  let allowed;
  let submitterCap;
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
    // what the temporary store holds per query, and which of its hashes are paid
    held = new Map();
    paid = new Set();
    dbHelper = {
      databaseConnection: sinon.stub().returns({ db: (name) => name }),
      findInDatabase: sinon.stub().callsFake(async (database, collection, query) => {
        if (collection === 'hashes') return query.hash.$in.filter((hash) => paid.has(hash)).map((hash) => ({ hash }));
        return held.get(JSON.stringify(query)) ?? [];
      }),
    };
    verifyBroadcasts = sinon.stub().resolves([{ result: VerifyResult.OK }]);
    clientTagFor = sinon.stub().resolves({ clientTag: TAG, clientTagHeight: TAG_HEIGHT });
    getFluxNodePublicKey = sinon.stub().resolves(ENTRY_KEY);
    allowed = { clientTagCap: 3, originKeyCap: 5, largestClientCap: 3 };
    submitterCap = sinon.stub().returns(null);
    unpaidAdmission = proxyquire('../../ZelBack/src/services/appMessaging/unpaidAdmission', {
      config: {
        database: { appsglobal: { database: 'appsglobal' }, daemon: { database: 'daemon' } },
      },
      '../utils/unpaidAllowances': { allowances: () => allowed, submitterCap },
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

  const holding = (query, count, hashes = Array.from({ length: count }, (_, i) => `held${i}`)) => {
    held.set(JSON.stringify(query), hashes.map((hash) => ({ hash })));
  };

  it('should stub only names the real modules export', () => {
    expect(realAllowances.allowances).to.be.a('function');
    expect(realAllowances.submitterCap).to.be.a('function');
  });

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

    it('carries a client cap last, and only where a submitter range granted one', () => {
      const built = unpaidAdmission.admittedMessage({ clientTagCap: 40, ...tagged() });

      expect(Object.keys(built).at(-1)).to.equal('clientTagCap');
      expect(JSON.stringify(built)).to.equal(JSON.stringify(tagged({ clientTagCap: 40 })));
    });
  });

  describe('admitUnpaid: a live announcement', () => {
    it('takes a tagged message under both allowances, keeping its admitting node\'s signature', async () => {
      const data = tagged();

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission).to.have.all.keys('fields', 'release');
      expect(admission.fields).to.deep.equal({
        clientTag: TAG, clientTagHeight: TAG_HEIGHT, origin: originBy(), originKey: ENTRY_KEY,
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
      paid.add('held1');
      const data = tagged();

      const admission = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(admission.refused).to.equal(undefined);
      sinon.assert.calledWithExactly(dbHelper.findInDatabase, 'daemon', 'hashes', { hash: { $in: ['held0', 'held1', 'held2'] } }, { projection: { _id: 0, hash: 1 } });
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

  describe('admitUnpaid: a client cap a submitter range granted', () => {
    const admitWithCap = (clientTagCap, fields = {}) => {
      const data = tagged({ clientTagCap, ...fields });
      return unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });
    };

    beforeEach(() => {
      allowed = { clientTagCap: 3, originKeyCap: 5, largestClientCap: 4 };
    });

    it('holds the client to the cap its message carries, and stores it beside the message', async () => {
      holding({ clientTag: TAG }, 3);

      const admission = await admitWithCap(4);

      expect(admission.fields).to.include({ clientTagCap: 4 });
      holding({ clientTag: TAG }, 4);
      expect(await admitWithCap(4, { hash: 'hash2' })).to.deep.equal({ refused: 'its client already has 4 unpaid app messages pending' });
    });

    it('stores no cap beside a message that carries none', async () => {
      const data = tagged();

      const { fields } = await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      expect(fields).to.not.have.property('clientTagCap');
    });

    it('holds a client to the policy\'s cap when its message carries a lower one', async () => {
      holding({ clientTag: TAG }, 2);

      expect(await admitWithCap(1)).to.not.have.property('refused');
    });

    it('refuses a cap above the largest the network policy grants', async () => {
      expect(await admitWithCap(5)).to.deep.equal({ refused: 'its client cap 5 is above the largest the network policy grants (4)' });
    });

    [['a fraction', 2.5], ['zero', 0], ['text', '4']].forEach(([label, cap]) => {
      it(`refuses a cap that is ${label}`, async () => {
        expect(await admitWithCap(cap)).to.deep.equal({ refused: 'its client cap is malformed' });
      });
    });

    it('still holds the operator to its allowance', async () => {
      holding({ originKey: ENTRY_KEY }, 5);

      expect(await admitWithCap(4)).to.deep.equal({ refused: 'its admitting operator already has 5 unpaid app messages pending' });
    });
  });

  describe('admitUnpaid: a reply rebuilt from storage', () => {
    it('checks the admitting node\'s signature over the message itself, as that node signed it', async () => {
      const origin = originBy();
      // the answering node signs the reply frame; the origin is the admitting node's
      const reply = tagged({ origin });

      const admission = await unpaidAdmission.admitUnpaid(reply, { frame: frameOf(reply, RELAY_KEY), daemonHeight: TIP });

      expect(admission.fields).to.deep.equal({
        clientTag: TAG, clientTagHeight: TAG_HEIGHT, origin, originKey: ENTRY_KEY,
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

  describe('admitUnpaid: messages in flight', () => {
    // Each its own message, arriving alone in its admitting node's frame.
    const admitLive = (fields) => {
      const data = tagged(fields);
      return unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });
    };
    const taken = (admissions) => admissions.filter((admission) => !admission.refused);

    it('holds messages admitted at the same moment to the client\'s allowance', async () => {
      const admissions = await Promise.all([1, 2, 3, 4, 5].map((i) => admitLive({ hash: `burst${i}` })));

      expect(taken(admissions)).to.have.length(3);
      expect(admissions.filter((admission) => admission.refused)).to.deep.equal([
        { refused: 'its client already has 3 unpaid app messages pending' },
        { refused: 'its client already has 3 unpaid app messages pending' },
      ]);
    });

    it('holds messages admitted at the same moment to the operator\'s allowance, whatever tags they carry', async () => {
      const admissions = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => admitLive({ hash: `burst${i}`, clientTag: String(i).repeat(64) })));

      expect(taken(admissions)).to.have.length(5);
      expect(admissions.filter((admission) => admission.refused)).to.deep.equal([
        { refused: 'its admitting operator already has 5 unpaid app messages pending' },
        { refused: 'its admitting operator already has 5 unpaid app messages pending' },
      ]);
    });

    it('counts a message in flight on top of those stored', async () => {
      holding({ clientTag: TAG }, 2);
      await admitLive({ hash: 'flying' });

      expect(await admitLive({ hash: 'next' })).to.deep.equal({ refused: 'its client already has 3 unpaid app messages pending' });
    });

    it('gives back exactly one place when a message is released', async () => {
      const [first] = await Promise.all([1, 2, 3].map((i) => admitLive({ hash: `burst${i}` })));

      first.release();

      expect(taken([await admitLive({ hash: 'after' })])).to.have.length(1);
      expect(await admitLive({ hash: 'again' })).to.deep.equal({ refused: 'its client already has 3 unpaid app messages pending' });
    });

    it('counts a message stored while still in flight once', async () => {
      const flying = await admitLive({ hash: 'stored' });
      holding({ clientTag: TAG }, 1, ['stored']);
      holding({ originKey: ENTRY_KEY }, 1, ['stored']);

      const admissions = await Promise.all([admitLive({ hash: 'second' }), admitLive({ hash: 'third' })]);

      expect(taken(admissions)).to.have.length(2);
      flying.release();
    });

    it('gives two copies of one message one place, kept until both are released', async () => {
      const copies = await Promise.all([admitLive({ hash: 'same' }), admitLive({ hash: 'same' })]);
      await admitLive({ hash: 'other1' });
      await admitLive({ hash: 'other2' });
      expect(await admitLive({ hash: 'other3' })).to.have.property('refused');

      // a copy released twice gives back its share once, so the other copy keeps the place
      copies[0].release();
      copies[0].release();
      expect(await admitLive({ hash: 'other3' })).to.have.property('refused');

      copies[1].release();
      expect(taken([await admitLive({ hash: 'other3' })])).to.have.length(1);
    });

    it('counts a message written and released while another check reads the store', async () => {
      await admitLive({ hash: 'other1' });
      await admitLive({ hash: 'other2' });
      const late = await admitLive({ hash: 'late' });
      // the next check's reads start before late's write lands, so they do not see it
      const landings = [];
      let readStarted;
      const reading = new Promise((resolve) => { readStarted = resolve; });
      dbHelper.findInDatabase.callsFake(async () => {
        readStarted();
        await new Promise((land) => { landings.push(land); });
        return [];
      });

      const checking = admitLive({ hash: 'next' });
      await reading;
      late.release();
      landings.forEach((land) => land());

      expect(await checking).to.deep.equal({ refused: 'its client already has 3 unpaid app messages pending' });
    });

    it('holds no place for a refused message', async () => {
      holding({ clientTag: TAG }, 3);
      expect(await admitLive({ hash: 'refused' })).to.have.property('refused');
      held.clear();

      const admissions = await Promise.all([1, 2, 3].map((i) => admitLive({ hash: `burst${i}` })));

      expect(taken(admissions)).to.have.length(3);
    });

    it('holds no place for a message without a tag', async () => {
      const data = message({ hash: 'untagged' });
      await unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });

      const admissions = await Promise.all([1, 2, 3].map((i) => admitLive({ hash: `burst${i}` })));

      expect(taken(admissions)).to.have.length(3);
    });
  });

  describe('tagSubmission', () => {
    const client = { remoteAddress: '198.51.100.25', headers: {} };

    it('gives the tag for a client under both allowances', async () => {
      expect(await unpaidAdmission.tagSubmission(client, TIP)).to.deep.equal({ clientTag: TAG, clientTagHeight: TAG_HEIGHT });
      sinon.assert.calledOnceWithExactly(clientTagFor, client, TIP);
    });

    it('gives the cap a submitter range grants its caller, and holds the caller to it', async () => {
      submitterCap.returns(4);
      allowed = { clientTagCap: 3, originKeyCap: 5, largestClientCap: 4 };
      holding({ clientTag: TAG }, 3);

      expect(await unpaidAdmission.tagSubmission(client, TIP)).to.deep.equal({ clientTag: TAG, clientTagHeight: TAG_HEIGHT, clientTagCap: 4 });
      sinon.assert.calledWithExactly(submitterCap, client);

      holding({ clientTag: TAG }, 4);
      await unpaidAdmission.tagSubmission(client, TIP).then(
        () => expect.fail('should have refused'),
        (error) => expect(error.message).to.include('its client already has 4'),
      );
    });

    it('refuses a client the network would refuse', async () => {
      holding({ clientTag: TAG }, 3);

      await unpaidAdmission.tagSubmission(client, TIP).then(
        () => expect.fail('should have refused'),
        (error) => expect(error.message).to.equal('The network will not take this app message: its client already has 3 unpaid app messages pending. Pending messages expire after an hour.'),
      );
    });

    it('counts the messages in flight, and holds no place itself', async () => {
      await Promise.all([1, 2].map((i) => {
        const data = tagged({ hash: `flying${i}` });
        return unpaidAdmission.admitUnpaid(data, { frame: frameOf(data), daemonHeight: TIP });
      }));

      expect(await unpaidAdmission.tagSubmission(client, TIP)).to.deep.equal({ clientTag: TAG, clientTagHeight: TAG_HEIGHT });
      expect(await unpaidAdmission.tagSubmission(client, TIP)).to.deep.equal({ clientTag: TAG, clientTagHeight: TAG_HEIGHT });
      const third = tagged({ hash: 'flying3' });
      await unpaidAdmission.admitUnpaid(third, { frame: frameOf(third), daemonHeight: TIP });
      await unpaidAdmission.tagSubmission(client, TIP).then(
        () => expect.fail('should have refused'),
        (error) => expect(error.message).to.include('its client already has 3'),
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
