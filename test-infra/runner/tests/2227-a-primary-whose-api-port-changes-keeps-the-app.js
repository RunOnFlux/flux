// weight: heavy
import {
  describe, it, before, after,
} from 'mocha';
import { expect } from 'chai';
import { restartFluxos, setNodeApiPort } from '../framework/container.js';
import { setNodeAddress, clearNodeAddress, getJournal } from '../framework/daemon-control.js';
import { enableUpnpGateway, upnpGatewayState } from '../framework/external-http-control.js';
import { clearMaster, resetFdm } from '../framework/fdm-control.js';
import { waitFor, waitForUp, waitForAppRemoved } from '../framework/wait.js';
import { dbClient } from '../framework/db-client.js';
import { socketAddr } from '../framework/state-events.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';
import { authenticate } from '../auth.js';
import { fluxTeamKey } from '../framework/keys.js';
import { placeSilentPrimaryApp, A, B, C } from '../framework/silent-primary.js';

// The primary's operator moves its api port on the same IP, 16127 to 16157, and
// restarts FluxOS; a node on any port but 16127 runs only behind a UPnP gateway,
// so it is put behind one first. FDM names the primary by IP, which has not
// changed. The primary keeps the app, its peers hear the move and hold the app
// at its new port only, and the standby follows it there: when the primary gives
// the app up, the standby asks it at its new port and takes over.
//
// A = the standby, B = the primary, C = a bystander the discovery ring needs.

const SIGTERM_EXPIRY_S = 120;
const NEW_PORT = 16157;
const DETECTION_MS = 8 * 60 * 1000;
// Election passes after the move in which the primary could stand down.
const PASSES_WATCHED_MS = 3 * 60 * 1000;
const TAKEOVER_MS = 6 * 60 * 1000;

describe('a primary whose api port changes keeps the app', function () {
  let fleet;
  dumpLogsOnFailure(() => fleet?.env);
  const appName = `e2eportprimary${Date.now()}`;
  const client = (i) => fleet.env.clients[i];
  let nodeIp;

  before(async function () {
    this.timeout(900000);
    fleet = await placeSilentPrimaryApp({ hookCtx: this, appName, sigtermExpiryS: SIGTERM_EXPIRY_S });
    nodeIp = client(B).ip;
  });

  after(async function () {
    this.timeout(60000);
    fleet?.stop();
    await clearNodeAddress(nodeIp).catch(() => {});
    await resetFdm().catch(() => {});
    await fleet?.env.teardown();
  });

  it('runs on at its new port', async function () {
    this.timeout(DETECTION_MS + PASSES_WATCHED_MS + 360000);
    const newSocket = `${nodeIp}:${NEW_PORT}`;

    const confirmations = async () => (await getJournal({ method: 'createconfirmationtransaction', sourceIp: nodeIp })).total;
    const confirmedBefore = await confirmations();
    await enableUpnpGateway(nodeIp);
    await setNodeApiPort(client(B).container, NEW_PORT);
    await setNodeAddress(nodeIp, newSocket, { scope: 'benchmark' });
    await restartFluxos(client(B).container, { apiPort: NEW_PORT });
    const followed = await client(B).followTo(nodeIp, NEW_PORT);
    const { mappings } = await upnpGatewayState(nodeIp);
    expect(mappings.map((m) => m.externalPort), 'fixture: the primary mapped its new api port').to.include(NEW_PORT);

    // A node that detects its move asks for its new address to be confirmed.
    await waitFor(async () => (await confirmations()) > confirmedBefore, {
      timeout: DETECTION_MS, interval: 5000, label: 'the primary detects its move',
    });
    // The chain has caught up: the network lists the primary at its new port.
    await setNodeAddress(nodeIp, newSocket, { scope: 'all' });
    await new Promise((resolve) => { setTimeout(resolve, PASSES_WATCHED_MS); });
    await waitForUp(client(B), appName, 'the primary runs the app at its new port', { timeout: 120000, interval: 3000 });

    await client(B).waitForEvent('syncthing:passComplete', () => true, 120000, { afterId: client(B).getLastEventId() });
    expect(client(B).getEventBuffer().filter((e) => e.event === 'primaryRole:changed' && e.id > followed
      && e.data.identifier === fleet.identifier && e.data.from === 'primary'),
    'the primary gave up its role for the port it left').to.deep.equal([]);
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });

  it('is heard moving by every peer, and held at its new port only', async function () {
    this.timeout(300000);
    const oldSocket = socketAddr(B + 1);
    const newSocket = `${nodeIp}:${NEW_PORT}`;
    const heldMove = async (i) => (await dbClient(i + 1).getAppStateEvents({ ip: oldSocket, type: 'ipchanged' }))
      .some((event) => event.data?.newIP === newSocket);
    await waitFor(async () => (await heldMove(B)) && (await heldMove(A)) && (await heldMove(C)), {
      timeout: 240000, interval: 5000, label: 'the primary and every peer hold the move',
    });
    // eslint-disable-next-line no-restricted-syntax
    for (const i of [A, B, C]) {
      // eslint-disable-next-line no-await-in-loop
      const held = await dbClient(i + 1).getAppLocations(appName);
      expect(held.map((row) => row.ip).filter((ip) => ip.startsWith(`${nodeIp}:`)), `node ${i}'s rows for the primary`).to.deep.equal([newSocket]);
    }
  });

  it('is followed to its new port, so the standby takes over once it gives the app up there', async function () {
    this.timeout(TAKEOVER_MS + 240000);
    await clearMaster(appName);
    const auth = await authenticate(client(B).url, fluxTeamKey());
    const res = await fetch(`${client(B).url}/apps/appremove/${appName}`, { headers: { zelidauth: auth.zelidauth } });
    await res.text();
    await waitForAppRemoved(client(B), appName, 180000);

    await waitForUp(client(A), appName, 'the standby runs the app', { timeout: TAKEOVER_MS, interval: 3000 });
    expect(fleet.twoRan, 'moments when more than one node ran the component').to.deep.equal([]);
  });
});
