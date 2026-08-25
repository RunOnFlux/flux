import { controlFetch } from './control-fetch.js';
const CONTROL_PORT = 16128;

export function stubPeerClient(ip) {
  const controlUrl = `http://${ip}:${CONTROL_PORT}`;

  return {
    ip,
    controlUrl,

    async loadMessage(permanentMessage) {
      const res = await controlFetch(`${controlUrl}/load-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(permanentMessage),
      });
      return res.json();
    },

    async getStats() {
      const res = await controlFetch(`${controlUrl}/stats`);
      return res.json();
    },

    // What this peer claims to be holding. A folder named here blocks the asking
    // node's promotion, so it keeps asking every pass instead of promoting once
    // and falling silent.
    async setPromotedFolders({ ready = true, folders = [] } = {}) {
      const res = await controlFetch(`${controlUrl}/promoted-folders`, {
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
      const res = await controlFetch(`${controlUrl}/promoted-folders-status`, {
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
      const res = await controlFetch(`${controlUrl}/promoted-folders-refuse`, {
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
      const res = await controlFetch(`${controlUrl}/broadcast`, {
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

    // How many fleet nodes hold an open connection to this peer RIGHT NOW.
    //
    // Everything this stub says is said over those sockets, so this is the
    // precondition for any of it mattering. A suite that broadcasts before the
    // fleet has dialled in is talking to an empty set, and the failure surfaces
    // minutes later as whatever it was waiting for never happening.
    async connectedNodes() {
      const stats = await this.getStats();
      return stats.connectedNodes ?? 0;
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
      // /broadcast reports how many nodes it actually reached, and a peer with
      // no open sockets reaches NONE - it serialises, signs, sends to an empty
      // set and answers 200. A caller that ignores that awaits an outcome the
      // fleet was never told about, times out, and reports the fleet as having
      // failed to notice something nobody said.
      //
      // So the first announcement is checked, not merely unswallowed. Later
      // keep-alives stay best-effort: by then the holder is established, and a
      // dropped one is recovered by the next.
      const announce = async () => {
        const result = await this.runApp(name, { hash, runningSince, ...rest });
        if (!result || !result.sent) {
          throw new Error(
            `stub peer announced ${name} to nobody (sent=${result?.sent ?? 'unknown'}, `
            + `connected=${result?.connected ?? 'unknown'}) - it has no open connections to broadcast over`,
          );
        }
        return result;
      };
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
      const res = await controlFetch(`${controlUrl}/clear`, { method: 'POST' });
      return res.json();
    },
  };
}
