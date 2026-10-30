const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

// RFC 5737 / RFC 3849 documentation ranges: a fixture that carries a real
// address invites someone to treat it as one.
const CLIENT = '198.51.100.25';
const OTHER_CLIENT = '198.51.100.26';
const CLIENT_V6 = '2001:db8:1:2:aaaa::1';
const SAME_64 = '2001:db8:1:2:bbbb::9';
const OTHER_64 = '2001:db8:1:3:aaaa::1';

describe('clientTag tests', () => {
  let executeCall;
  let clientTag;

  beforeEach(() => {
    executeCall = sinon.stub().callsFake(async (rpc, [height]) => ({ status: 'success', data: `blockhash-${height}` }));
    clientTag = proxyquire('../../ZelBack/src/services/utils/clientTag', {
      '../daemonService/daemonServiceUtils': { executeCall },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('clientPrefix', () => {
    it('keeps an IPv4 address whole', () => {
      expect(clientTag.clientPrefix(CLIENT)).to.equal(CLIENT);
    });

    it('reduces an IPv6 address to its /64', () => {
      expect(clientTag.clientPrefix(CLIENT_V6)).to.equal('2001:db8:1:2::/64');
      expect(clientTag.clientPrefix(SAME_64)).to.equal('2001:db8:1:2::/64');
      expect(clientTag.clientPrefix(OTHER_64)).to.equal('2001:db8:1:3::/64');
    });

    it('reads every spelling of one /64 the same', () => {
      expect(clientTag.clientPrefix('2001:0DB8:0001:0002:0:0:0:1')).to.equal('2001:db8:1:2::/64');
      expect(clientTag.clientPrefix('2001:db8::1')).to.equal('2001:db8:0:0::/64');
      expect(clientTag.clientPrefix('::1')).to.equal('0:0:0:0::/64');
    });

    it('counts a trailing dotted IPv4 part as two groups', () => {
      expect(clientTag.clientPrefix('64:ff9b::198.51.100.25')).to.equal('64:ff9b:0:0::/64');
      expect(clientTag.clientPrefix('2001:db8:1:2:3:4:198.51.100.25')).to.equal('2001:db8:1:2::/64');
    });

    it('has no prefix for something that is not an address', () => {
      expect(clientTag.clientPrefix('not-an-ip')).to.equal(null);
    });
  });

  describe('tag heights', () => {
    it('salts with the newest 120-block boundary at least ten blocks deep', () => {
      expect(clientTag.tagHeightFor(3081729)).to.equal(3081600);
      expect(clientTag.tagHeightFor(3081730)).to.equal(3081720);
      expect(clientTag.tagHeightFor(3081610)).to.equal(3081600);
      expect(clientTag.tagHeightFor(3081609)).to.equal(3081480);
    });

    it('takes the current boundary and its neighbours', () => {
      const tip = 3081700; // current boundary 3081600
      expect(clientTag.tagHeightIsCurrent(3081600, tip)).to.equal(true);
      expect(clientTag.tagHeightIsCurrent(3081480, tip)).to.equal(true);
      expect(clientTag.tagHeightIsCurrent(3081720, tip)).to.equal(true);
    });

    it('refuses a boundary two away, a height off a boundary, and anything not an integer', () => {
      const tip = 3081700;
      expect(clientTag.tagHeightIsCurrent(3081360, tip)).to.equal(false);
      expect(clientTag.tagHeightIsCurrent(3081840, tip)).to.equal(false);
      expect(clientTag.tagHeightIsCurrent(3081601, tip)).to.equal(false);
      expect(clientTag.tagHeightIsCurrent('3081600', tip)).to.equal(false);
      expect(clientTag.tagHeightIsCurrent(undefined, tip)).to.equal(false);
    });
  });

  describe('clientTagFor', function clientTagForTests() {
    // each distinct tag is one real scrypt, about 0.35 s
    this.timeout(20000);

    const tip = 3081700;
    const from = (remoteAddress, headers = {}) => ({ remoteAddress, headers });

    it('tags a client by scrypt over its address, salted with the block at the tag height', async () => {
      const { clientTag: tag, clientTagHeight } = await clientTag.clientTagFor(from(CLIENT), tip);

      expect(clientTagHeight).to.equal(3081600);
      expect(tag).to.match(/^[0-9a-f]{64}$/);
      sinon.assert.calledOnceWithExactly(executeCall, 'getBlockHash', [3081600]);
    });

    it('gives one client the same tag on every request, computing it once', async () => {
      const first = await clientTag.clientTagFor(from(CLIENT), tip);
      const second = await clientTag.clientTagFor(from(`::ffff:${CLIENT}`), tip + 5);

      expect(second).to.deep.equal(first);
      sinon.assert.calledOnce(executeCall);
    });

    it('gives two clients different tags', async () => {
      const first = await clientTag.clientTagFor(from(CLIENT), tip);
      const second = await clientTag.clientTagFor(from(OTHER_CLIENT), tip);

      expect(second.clientTag).to.not.equal(first.clientTag);
    });

    it('gives every address in one IPv6 /64 the same tag, and another /64 a different one', async () => {
      const first = await clientTag.clientTagFor(from(CLIENT_V6), tip);
      const sameBlock = await clientTag.clientTagFor(from(SAME_64), tip);
      const otherBlock = await clientTag.clientTagFor(from(OTHER_64), tip);

      expect(sameBlock.clientTag).to.equal(first.clientTag);
      expect(otherBlock.clientTag).to.not.equal(first.clientTag);
    });

    it('gives the same client a new tag when the salt height moves', async () => {
      const first = await clientTag.clientTagFor(from(CLIENT), tip);
      const next = await clientTag.clientTagFor(from(CLIENT), tip + 120);

      expect(next.clientTagHeight).to.equal(first.clientTagHeight + 120);
      expect(next.clientTag).to.not.equal(first.clientTag);
    });

    it('tags the caller a trusted balancer names, not the balancer', async () => {
      // tests/unit/globalconfig lists 1.2.3.4 as a balancer
      const forwarded = await clientTag.clientTagFor(from('1.2.3.4', { 'x-forwarded-for': CLIENT }), tip);
      const direct = await clientTag.clientTagFor(from(CLIENT), tip);

      expect(forwarded.clientTag).to.equal(direct.clientTag);
    });

    it('refuses a request whose address cannot be read', async () => {
      await clientTag.clientTagFor(from(undefined), tip).then(
        () => expect.fail('should have refused'),
        (error) => expect(error.message).to.equal('Unable to determine the address this request came from'),
      );
      sinon.assert.notCalled(executeCall);
    });

    it('refuses when the daemon cannot give the salt', async () => {
      executeCall.resolves({ status: 'error', data: { message: 'no block' } });

      await clientTag.clientTagFor(from(CLIENT), tip).then(
        () => expect.fail('should have refused'),
        (error) => expect(error.message).to.equal('Unable to read the block hash at 3081600'),
      );
    });
  });
});
