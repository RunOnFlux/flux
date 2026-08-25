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

    // Make this peer refuse the question at the transport, which is what a node
    // whose FluxOS is not listening does. A status is an answer and the asker
    // reads any answer as "alive"; refusal is the only way a suite can put a
    // holder in front of it that is running but unanswerable.
    async refusePromotedFolders(refuse = true) {
      const res = await fetch(`${controlUrl}/promoted-folders-refuse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refuse }),
      });
      return res.json();
    },

    // Make this peer pass a port test without connecting to the asker at all.
    //
    // What the asker receives from a peer probing a shared public address: the
    // router forwarded the port to a sibling node, the sibling's application
    // answered, and the peer reports a pass for a port that never reached the
    // asker. The peer is not lying - something did answer - so the asker cannot
    // learn this from the reply, only from whether anything arrived at its own
    // test server.
    // An OLD peer: it reaches the ports and passes them, but returns no reading,
    // so the asker learns nothing it can act on and must ask someone else.
    async answerPortProbeBlind(blind = true) {
      const res = await fetch(`${controlUrl}/port-probe-blind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blind }),
      });
      return res.json();
    },

    // A peer that reads the port and finds somebody ELSE on it - which is what
    // the asker receives when the router forwarded that port to a neighbour.
    async answerPortProbeForeign(foreign = true) {
      const res = await fetch(`${controlUrl}/port-probe-foreign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foreign }),
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

    // Announce this peer is RUNNING an app, the way any holder announces it.
    //
    // The harness had no way to say this. A stub could claim an app it was about
    // to install and it could withdraw that claim, but it could not hold one -
    // so no suite could build a fleet where an app runs on more nodes than it
    // needs, which is the only state the surplus rule is ever asked about. The
    // suites that test surplus reach it through contested CLAIMS instead, and
    // that is a different moment in an app's life: no volume, no election, no
    // writer.
    //
    // `runningSince` is what every node ranks holders by, so it is the argument
    // that matters here. Backdate it and this peer is the senior holder, which
    // is how a test puts the surplus on a REAL node instead of on the stub.
    //
    // Sent as a broadcast like everything else - the receiving node validates
    // and stores it through its ordinary path, so this is a peer saying it holds
    // something, not a row written behind a node's back.
    async runApp(name, { hash, broadcastedAt = Date.now(), runningSince = broadcastedAt, osUptime = 86400 } = {}) {
      return this.broadcast({
        type: 'fluxapprunning',
        version: 2,
        apps: [{ name, hash, runningSince: new Date(runningSince).toISOString() }],
        ip,
        broadcastedAt,
        osUptime,
        staticIp: false,
      });
    },

    // Hold an app the way a real holder does: announce it, and keep announcing
    // it. A single runApp() is not a holder - the location it creates expires
    // after locationTtlS (63s in this harness), so a suite that announces once
    // and then does anything slow watches its own fixture disappear halfway
    // through, and reads the result as the code under test doing something.
    //
    // Returns a stop function. Call it in `after`, or the interval outlives the
    // fleet it was talking to.
    holdApp(name, { hash, runningSince = Date.now(), everyMs = 20000, ...rest } = {}) {
      // The FIRST announcement is not swallowed. A caller awaits `started` and
      // then waits for the fleet to count this peer as a holder; if that first
      // send failed, the caller otherwise sits out its whole timeout watching
      // for something that was never sent, and reports it as the fleet failing
      // to notice rather than as this failing to speak. Later re-announcements
      // are best-effort - by then the holder is established and a dropped
      // keep-alive is recovered by the next one.
      const announce = () => this.runApp(name, { hash, runningSince, ...rest });
      const timer = setInterval(() => { announce().catch(() => {}); }, everyMs);
      return { started: announce(), stop: () => clearInterval(timer) };
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
