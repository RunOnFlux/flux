const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const fetch = require('../../ZelBack/src/services/utils/announcementFetch');

describe('announcementFetch tests', () => {
  const HASH = 'a'.repeat(40);
  let clock;
  let request;
  let onMiss;
  let onServed;
  let latencies;
  let seen;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    request = sinon.stub();
    onMiss = sinon.stub();
    latencies = {};
    seen = new Set();
    fetch.reset();
    onServed = sinon.stub();
    fetch.wire({
      request, onMiss, onServed, latencyOf: (key) => latencies[key] ?? null, seen: (hash) => seen.has(hash),
    });
  });

  afterEach(() => {
    fetch.reset();
    clock.restore();
  });

  const asked = () => request.getCalls().map((c) => c.args[0]);
  const timeout = (ms) => clock.tick(ms);
  const { hashFetchRttMultiplier, hashFetchBaseMs, hashFetchDefaultMs } = config.fluxapps;

  it('asks the first announcer only, however many announce', () => {
    ['A', 'B', 'C'].forEach((peer) => fetch.announced(HASH, peer));
    expect(asked()).to.deep.equal(['A']);
  });

  it('asks nobody for a message it holds', () => {
    seen.add(HASH);
    fetch.announced(HASH, 'A');
    expect(asked()).to.deep.equal([]);
  });

  it('gives a peer a multiple of its round trip plus the base, and the default before it is measured', () => {
    latencies.A = 40;
    expect(fetch.timeoutFor('A')).to.equal(hashFetchRttMultiplier * 80 + hashFetchBaseMs);
    expect(fetch.timeoutFor('unmeasured')).to.equal(hashFetchDefaultMs);
  });

  it('asks the next announcer when the peer asked times out, not before', () => {
    latencies.A = 10;
    fetch.announced(HASH, 'A');
    fetch.announced(HASH, 'B');
    timeout(fetch.timeoutFor('A') - 1);
    expect(asked()).to.deep.equal(['A']);
    timeout(1);
    expect(asked()).to.deep.equal(['A', 'B']);
  });

  it('asks each announcer once and stops', () => {
    latencies.A = 1;
    latencies.B = 1;
    fetch.announced(HASH, 'A');
    fetch.announced(HASH, 'B');
    fetch.announced(HASH, 'A');
    timeout(10000);
    expect(asked()).to.deep.equal(['A', 'B']);
  });

  it('asks nobody further once a copy is delivered', () => {
    fetch.announced(HASH, 'A');
    fetch.announced(HASH, 'B');
    fetch.verifyingCopy(HASH);
    fetch.delivered(HASH, 'A');
    timeout(10000);
    expect(asked()).to.deep.equal(['A']);
  });

  it('asks the next announcer at once when the copy does not verify', () => {
    fetch.announced(HASH, 'A');
    fetch.announced(HASH, 'B');
    fetch.verifyingCopy(HASH);
    fetch.rejected(HASH);
    expect(asked()).to.deep.equal(['A', 'B']);
  });

  it('keeps an announcement that arrives while a copy verifies, and asks it when the copy fails', () => {
    seen.add(HASH);
    fetch.verifyingCopy(HASH);
    fetch.announced(HASH, 'B');
    expect(asked()).to.deep.equal([]);
    seen.delete(HASH);
    fetch.rejected(HASH);
    expect(asked()).to.deep.equal(['B']);
  });

  const peer = (key) => ({ key });

  it('answers the copy held behind a copy that fails, and asks nobody', () => {
    const held = { msgObj: {}, peerSocket: peer('H') };
    fetch.announced(HASH, 'A');
    fetch.announced(HASH, 'B');
    fetch.verifyingCopy(HASH);
    fetch.holdCopy(HASH, held.msgObj, held.peerSocket);

    expect(fetch.rejected(HASH)).to.deep.equal(held);
    expect(asked()).to.deep.equal(['A']);
  });

  it('holds nothing while no copy is verified', () => {
    fetch.holdCopy(HASH, {}, peer('H'));
    fetch.verifyingCopy(HASH);

    expect(fetch.rejected(HASH)).to.equal(null);
  });

  it('holds one copy per sender, so forged copies cannot displace a genuine one', () => {
    fetch.verifyingCopy(HASH);
    fetch.holdCopy(HASH, { forged: 1 }, peer('F'));
    fetch.holdCopy(HASH, { forged: 2 }, peer('F'));
    fetch.holdCopy(HASH, { forged: 3 }, peer('F'));
    fetch.holdCopy(HASH, { genuine: true }, peer('H'));

    expect(fetch.rejected(HASH).msgObj).to.deep.equal({ forged: 1 });
    fetch.verifyingCopy(HASH);
    expect(fetch.rejected(HASH).msgObj).to.deep.equal({ genuine: true });
    expect(fetch.rejected(HASH)).to.equal(null);
  });

  it('drops the held copy when the first verifies', () => {
    fetch.verifyingCopy(HASH);
    fetch.holdCopy(HASH, {}, peer('H'));
    fetch.delivered(HASH, 'A');
    fetch.verifyingCopy(HASH);

    expect(fetch.rejected(HASH)).to.equal(null);
  });

  it('charges a miss to a peer that timed out only once another delivers', () => {
    latencies.A = 1;
    fetch.announced(HASH, 'A');
    fetch.announced(HASH, 'B');
    timeout(fetch.timeoutFor('A'));
    sinon.assert.notCalled(onMiss);
    fetch.verifyingCopy(HASH);
    fetch.delivered(HASH, 'B');
    sinon.assert.calledOnceWithExactly(onMiss, 'A');
  });

  it('credits the peer that delivered', () => {
    fetch.announced(HASH, 'A');
    fetch.delivered(HASH, 'A');
    sinon.assert.calledOnceWithExactly(onServed, 'A');
  });

  it('waits again, asks nobody and charges nothing when its own timer fired late', () => {
    latencies.A = 1;
    const timeoutMs = fetch.timeoutFor('A');
    fetch.announced(HASH, 'A');
    fetch.announced(HASH, 'B');
    clock.setSystemTime(Date.now() + config.fluxapps.hashFetchLateMs + 1);
    clock.tick(timeoutMs);
    expect(asked()).to.deep.equal(['A']);

    clock.tick(timeoutMs);
    expect(asked()).to.deep.equal(['A', 'B']);
    fetch.delivered(HASH, 'A');
    sinon.assert.notCalled(onMiss);
  });

  it('gives each further peer asked twice as long, up to the most it backs off', () => {
    latencies.A = 1;
    const once = fetch.timeoutFor('A');
    expect(fetch.timeoutFor('A', 1)).to.equal(once * 2);
    expect(fetch.timeoutFor('A', 2)).to.equal(once * 4);
    expect(fetch.timeoutFor('A', 99)).to.equal(once * 2 ** config.fluxapps.hashFetchMaxBackoff);
  });

  it('waits longer before each further peer', () => {
    latencies.A = 1;
    latencies.B = 1;
    fetch.announced(HASH, 'A');
    fetch.announced(HASH, 'B');
    fetch.announced(HASH, 'C');
    timeout(fetch.timeoutFor('A'));
    expect(asked()).to.deep.equal(['A', 'B']);

    timeout(fetch.timeoutFor('B'));
    expect(asked(), 'the second peer has twice the time').to.deep.equal(['A', 'B']);
    timeout(fetch.timeoutFor('B'));
    expect(asked()).to.deep.equal(['A', 'B', 'C']);
  });

  it('charges nobody when nobody delivers', () => {
    latencies.A = 1;
    fetch.announced(HASH, 'A');
    timeout(10000);
    sinon.assert.notCalled(onMiss);
  });

  it('charges nothing to the peer that delivers late', () => {
    latencies.A = 1;
    fetch.announced(HASH, 'A');
    fetch.announced(HASH, 'B');
    timeout(fetch.timeoutFor('A'));
    fetch.delivered(HASH, 'A');
    sinon.assert.notCalled(onMiss);
  });

  it('asks the peer with the fewest misses first', () => {
    latencies.SLOW = 1;
    const other = 'b'.repeat(40);
    fetch.announced(HASH, 'SLOW');
    fetch.announced(HASH, 'GOOD');
    timeout(fetch.timeoutFor('SLOW'));
    fetch.delivered(HASH, 'GOOD');
    request.resetHistory();

    fetch.announced(other, 'FIRST');
    fetch.announced(other, 'SLOW');
    fetch.announced(other, 'GOOD');
    fetch.rejected(other);
    expect(asked()).to.deep.equal(['FIRST', 'GOOD']);
  });

  it('holds off asking a first announcer with misses, for a better one to announce', () => {
    latencies.SILENT = 1;
    const other = 'b'.repeat(40);
    fetch.announced(HASH, 'SILENT');
    fetch.announced(HASH, 'GOOD');
    timeout(fetch.timeoutFor('SILENT'));
    fetch.delivered(HASH, 'GOOD');
    request.resetHistory();

    fetch.announced(other, 'SILENT');
    expect(asked(), 'nobody yet').to.deep.equal([]);
    fetch.announced(other, 'BETTER');
    timeout(hashFetchBaseMs);
    expect(asked()).to.deep.equal(['BETTER']);
  });

  it('clears a miss for each message the peer delivers, and asks it at once again', () => {
    latencies.SLOW = 1;
    const other = 'b'.repeat(40);
    fetch.announced(HASH, 'SLOW');
    fetch.announced(HASH, 'GOOD');
    timeout(fetch.timeoutFor('SLOW'));
    fetch.delivered(HASH, 'GOOD');
    fetch.delivered('c'.repeat(40), 'SLOW');
    request.resetHistory();

    fetch.announced(other, 'SLOW');
    expect(asked()).to.deep.equal(['SLOW']);
  });

  it('asks a first announcer with misses after the wait when nobody better announces', () => {
    latencies.SILENT = 1;
    const other = 'b'.repeat(40);
    fetch.announced(HASH, 'SILENT');
    fetch.announced(HASH, 'GOOD');
    timeout(fetch.timeoutFor('SILENT'));
    fetch.delivered(HASH, 'GOOD');
    request.resetHistory();

    fetch.announced(other, 'SILENT');
    timeout(hashFetchBaseMs);
    expect(asked()).to.deep.equal(['SILENT']);
  });

  it('moves on at once when the peer asked goes, and forgets its misses', () => {
    fetch.announced(HASH, 'A');
    fetch.announced(HASH, 'B');
    fetch.peerGone('A');
    expect(asked()).to.deep.equal(['A', 'B']);
  });
});
