const CONTROL_PORT = 16128;

export function stubPeerClient(ip) {
  const controlUrl = `http://${ip}:${CONTROL_PORT}`;

  return {
    ip,
    controlUrl,

    async loadMessage(permanentMessage) {
      const res = await fetch(`${controlUrl}/load-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(permanentMessage),
      });
      return res.json();
    },

    async getStats() {
      const res = await fetch(`${controlUrl}/stats`);
      return res.json();
    },

    // What this peer claims to be holding. A folder named here blocks the asking
    // node's promotion, so it keeps asking every pass instead of promoting once
    // and falling silent.
    async setPromotedFolders({ ready = true, folders = [] } = {}) {
      const res = await fetch(`${controlUrl}/promoted-folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ready, folders }),
      });
      return res.json();
    },

    // Make this peer answer that question with an error status instead of an
    // answer - 404 being a node that has not been upgraded yet and has no such
    // endpoint. The fleet runs one image, so this is the only way a suite can
    // put a node in front of a peer it cannot ask.
    async answerPromotedFoldersWith(status) {
      const res = await fetch(`${controlUrl}/promoted-folders-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      return res.json();
    },

    // Arrival times of the node's "what are you holding?" requests.
    async promotedFolderRequests() {
      const stats = await this.getStats();
      return stats.promotedFolderRequests ?? [];
    },

    // Send a signed message to every node connected to this peer, framed as any
    // other broadcast - the receiver validates and stores it through its normal
    // path, so this is a peer saying something, not a row written behind a
    // node's back.
    async broadcast(data) {
      const res = await fetch(`${controlUrl}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },

    // Claim an app, as a peer that got there first. broadcastedAt decides the
    // ranking every contender sorts on, so an earlier one makes this peer the
    // rival the others must stand down behind.
    async claimApp(name, { broadcastedAt = Date.now() } = {}) {
      return this.broadcast({
        type: 'fluxappinstalling',
        version: 1,
        name,
        ip,
        broadcastedAt,
      });
    },

    // Give that claim up. Version 2 of the claim's own message, which is what a
    // node standing aside sends - so the fleet sees this peer leave the same way
    // it sees any other leave, and the app is free again.
    async withdrawApp(name, { broadcastedAt = Date.now() } = {}) {
      return this.broadcast({
        type: 'fluxappinstalling',
        version: 2,
        name,
        ip,
        broadcastedAt,
        withdrawn: true,
      });
    },

    async clear() {
      const res = await fetch(`${controlUrl}/clear`, { method: 'POST' });
      return res.json();
    },
  };
}
