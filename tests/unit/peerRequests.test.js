const { expect } = require('chai');

const { PeerRequests } = require('../../ZelBack/src/services/utils/peerRequests');

const PEER = '10.0.0.1:16127';
const tick = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('peerRequests tests', () => {
  describe('settling once', () => {
    it('reports the call that ended it, and no other', () => {
      const requests = new PeerRequests();
      requests.open(PEER);
      expect(requests.settle(PEER, 'answered')).to.equal(true);
      expect(requests.settle(PEER, 'timedOut')).to.equal(false);
    });

    it('keeps the outcome of the call that won', () => {
      const requests = new PeerRequests();
      const request = requests.open(PEER);
      requests.settle(PEER, 'answered');
      requests.settle(PEER, 'timedOut');
      expect(request.outcome).to.equal('answered');
    });

    it('settles nothing for a peer with no request', () => {
      expect(new PeerRequests().settle(PEER, 'answered')).to.equal(false);
    });
  });

  describe('which request an answer belongs to', () => {
    it('ignores an answer naming a different request', () => {
      const requests = new PeerRequests();
      requests.open(PEER, { id: 'second' });
      expect(requests.settle(PEER, 'answered', { id: 'first' })).to.equal(false);
      expect(requests.isOpen(PEER)).to.equal(true);
    });

    it('takes an answer naming no request, for peers that send no id', () => {
      const requests = new PeerRequests();
      requests.open(PEER, { id: 'second' });
      expect(requests.settle(PEER, 'answered')).to.equal(true);
    });

    it('ignores an answer from a channel the request did not go out on', () => {
      const requests = new PeerRequests();
      requests.open(PEER, { channel: 7 });
      expect(requests.settle(PEER, 'disconnected', { channel: 6 })).to.equal(false);
      expect(requests.settle(PEER, 'disconnected', { channel: 7 })).to.equal(true);
    });

    it('answers isOpen against the channel too', () => {
      const requests = new PeerRequests();
      requests.open(PEER, { channel: 7 });
      expect(requests.isOpen(PEER, { channel: 6 })).to.equal(false);
      expect(requests.isOpen(PEER, { channel: 7 })).to.equal(true);
      expect(requests.isOpen(PEER)).to.equal(true);
    });

    it('gives each request its own id when the caller names none', () => {
      const requests = new PeerRequests();
      const first = requests.open(PEER).id;
      const second = requests.open(PEER).id;
      expect(first).to.not.equal(second);
    });
  });

  describe('deadlines', () => {
    it('ends a request the peer never answered', async () => {
      const requests = new PeerRequests();
      const timedOut = [];
      const request = requests.open(PEER, {
        timeoutMs: 10,
        onTimeout: (key) => { timedOut.push(key); requests.settle(key, 'timedOut'); },
      });
      expect(await request.settled).to.equal('timedOut');
      expect(timedOut).to.deep.equal([PEER]);
    });

    it('restarts the clock when the peer shows it is working', async () => {
      const requests = new PeerRequests();
      const request = requests.open(PEER, {
        timeoutMs: 30,
        onTimeout: (key) => requests.settle(key, 'timedOut'),
      });
      await tick(20);
      requests.note(PEER, { timeoutMs: 200, onTimeout: (key) => requests.settle(key, 'stalled') });
      await tick(30);
      expect(request.outcome, 'the first deadline still fired').to.equal(null);
      requests.settle(PEER, 'answered');
      expect(await request.settled).to.equal('answered');
    });

    it('renews nothing for a request that has already ended', () => {
      const requests = new PeerRequests();
      requests.open(PEER);
      requests.settle(PEER, 'answered');
      expect(requests.note(PEER, { timeoutMs: 10, onTimeout: () => {} })).to.equal(false);
    });

    it('drops the deadline when the request ends, so nothing fires late', async () => {
      const requests = new PeerRequests();
      let fired = false;
      requests.open(PEER, { timeoutMs: 10, onTimeout: () => { fired = true; } });
      requests.settle(PEER, 'answered');
      await tick(30);
      expect(fired).to.equal(false);
    });
  });

  describe('nothing is left waiting', () => {
    it('releases a waiter when the request is discarded', async () => {
      const requests = new PeerRequests();
      const request = requests.open(PEER);
      requests.discard(PEER);
      expect(await request.settled).to.equal('discarded');
    });

    it('releases a waiter when a new request replaces it', async () => {
      const requests = new PeerRequests();
      const first = requests.open(PEER);
      requests.open(PEER);
      expect(await first.settled).to.equal('discarded');
    });
  });

  describe('the set as a whole', () => {
    it('counts only what is still open', () => {
      const requests = new PeerRequests();
      requests.open('a:1');
      requests.open('b:1');
      requests.settle('a:1', 'answered');
      expect(requests.openCount()).to.equal(1);
      expect(requests.has('a:1'), 'a settled request still stands').to.equal(true);
    });

    it('ends every open one and reports how many there were', () => {
      const requests = new PeerRequests();
      requests.open('a:1');
      requests.open('b:1');
      requests.settle('a:1', 'answered');
      expect(requests.settleAll('timedOut')).to.equal(1);
      expect(requests.openCount()).to.equal(0);
    });

    it('forgets them all, so every peer is available again', () => {
      const requests = new PeerRequests();
      requests.open('a:1');
      requests.open('b:1');
      requests.discardAll();
      expect(requests.keys()).to.deep.equal([]);
      expect(requests.has('a:1')).to.equal(false);
    });
  });

  describe('which peers have been heard from', () => {
    // What a caller deciding something about the peer SET reads, rather than keeping a
    // ledger of its own beside this one.
    it('separates a peer that answered from one still being waited on', () => {
      const requests = new PeerRequests();
      requests.open('a:1');
      requests.open('b:1');
      requests.settle('a:1', 'answered');
      expect(requests.settled('a:1')).to.equal(true);
      expect(requests.settled('b:1'), 'still open, so not yet heard from').to.equal(false);
    });

    it('counts a deadline as having been heard from, because the question is over', () => {
      // A deadline ends the question, so the peer counts as heard from: it told us nothing,
      // and nothing is waiting on it.
      const requests = new PeerRequests();
      requests.open('a:1');
      requests.settle('a:1', 'timedOut');
      expect(requests.settled('a:1')).to.equal(true);
    });

    it('says nothing of a peer never asked, or one since discarded', () => {
      const requests = new PeerRequests();
      expect(requests.settled('a:1'), 'never asked').to.equal(false);
      requests.open('a:1');
      requests.settle('a:1', 'answered');
      requests.discard('a:1');
      expect(requests.settled('a:1'), 'discarded with the peer that answered it').to.equal(false);
    });

    it('is reset by a fresh question to the same peer', () => {
      const requests = new PeerRequests();
      requests.open('a:1');
      requests.settle('a:1', 'answered');
      requests.open('a:1');
      expect(requests.settled('a:1'), 'asked again, so it is outstanding again').to.equal(false);
    });
  });

  // A caller deciding something about the peer set needs to know WHAT a peer answered, not
  // only that it did: "answered" covers a peer that agreed, one that holds nothing and one
  // that is ahead, and those mean different things about the asker.
  describe('what a peer answered', () => {
    it('is null while the question is still open', () => {
      const requests = new PeerRequests();
      requests.open('a:1');
      expect(requests.outcomeOf('a:1'), 'open, so it has established nothing').to.equal(null);
    });

    it('is null for a peer that was never asked', () => {
      const requests = new PeerRequests();
      expect(requests.outcomeOf('a:1')).to.equal(null);
    });

    it('is what settled it', () => {
      const requests = new PeerRequests();
      requests.open('a:1');
      requests.open('b:1');
      requests.settle('a:1', 'notAhead');
      requests.settle('b:1', 'holdsNothing');
      expect(requests.outcomeOf('a:1')).to.equal('notAhead');
      expect(requests.outcomeOf('b:1'), 'two answers, told apart').to.equal('holdsNothing');
    });

    it('keeps the first outcome, because settling happens once', () => {
      const requests = new PeerRequests();
      requests.open('a:1');
      requests.settle('a:1', 'notAhead');
      requests.settle('a:1', 'timedOut');
      expect(requests.outcomeOf('a:1')).to.equal('notAhead');
    });

    it('goes with the peer, so a record does not outlive its connection', () => {
      const requests = new PeerRequests();
      requests.open('a:1');
      requests.settle('a:1', 'notAhead');
      requests.discard('a:1');
      expect(requests.outcomeOf('a:1'), 'what the old socket said is not what a new one holds').to.equal(null);
    });

    it('is null again once the peer is asked afresh', () => {
      const requests = new PeerRequests();
      requests.open('a:1');
      requests.settle('a:1', 'notAhead');
      requests.open('a:1');
      expect(requests.outcomeOf('a:1'), 'a new question has no answer yet').to.equal(null);
    });
  });
});
