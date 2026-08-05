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

    // Arrival times of the node's "what are you holding?" requests.
    async promotedFolderRequests() {
      const stats = await this.getStats();
      return stats.promotedFolderRequests ?? [];
    },

    async clear() {
      const res = await fetch(`${controlUrl}/clear`, { method: 'POST' });
      return res.json();
    },
  };
}
