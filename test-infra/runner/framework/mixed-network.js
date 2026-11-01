// A fleet of Arcane and legacy nodes, and what unpaid app messages must do on it
// whatever its mix (suites 3709-3711).
//
// Twelve real nodes on the deterministic ring (each holds the four on either
// side) and two stub peers, both peered only with the observer: an Arcane stub,
// which relays over links it authenticates, and a plain stub, which relays as an
// older-release node does, over a link that never authenticates. Discovery runs
// with its random peers turned off, so the ring and the pass that holds
// authenticated links are the only ways a node gains peers. Every Arcane node
// admits at a quorum of 3 and holds 3 authenticated links.
import { expect } from 'chai';
import { appOwnerKey, nodeKey } from './keys.js';
import { buildAppSpec, signAppSpec } from './app-helper.js';
import { authenticate } from '../auth.js';
import { buildSeedableApp } from './seed-helper.js';
import { queueAppTx, advanceBlock } from './daemon-control.js';
import { getSubnetConfig } from './subnet-config.js';
import {
  currentTagHeight, freshClientTag, pendingMessage, admissionOf, pendingMessageOn,
} from './unpaid-messages.js';
import { waitFor } from './wait.js';

export const REAL = Array.from({ length: 12 }, (_, i) => i);
export const ARCANE_STUB = 12;
export const PLAIN_STUB = 13;
export const QUORUM = 3;

/**
 * createTestEnv's options for a mix.
 * @param {{legacy: number[], observer: number, ipGroups?: object}} mix
 * @returns {object}
 */
export function mixedFleet({ legacy, observer, ipGroups = {} }) {
  return {
    nodes: REAL.length + 2,
    legacyNodes: legacy,
    stubPeers: [ARCANE_STUB, PLAIN_STUB],
    arcaneStubPeers: [ARCANE_STUB],
    stubPeeredWith: { [ARCANE_STUB]: [observer], [PLAIN_STUB]: [observer] },
    ipGroups,
    discoveryAutostart: true,
    configOverrides: {
      fdmAddresses: [getSubnetConfig().gateway],
      fluxapps: {
        admissionQuorum: QUORUM,
        admissionLinkTarget: QUORUM,
        discoveryMaxOutbound: 0,
        discoveryMinUniqueOutboundIps: 0,
        discoveryMaxInbound: 0,
        discoveryMinUniqueInboundIps: 0,
      },
    },
  };
}

/**
 * The checks every mix runs. `env` is read when each runs, after boot.
 * @param {function(): object} getEnv
 * @param {{legacy: number[], observer: number}} mix
 */
export function mixedNetworkChecks(getEnv, { legacy, observer }) {
  const arcane = REAL.filter((i) => !legacy.includes(i));
  const owner = appOwnerKey();
  const stamp = Date.now();
  let count = 0;
  const name = (label) => { count += 1; return `e2emix${label}${count}x${stamp}`; };

  // A registration through one node's door, from a client of its own.
  const registerThrough = async (index) => {
    const env = getEnv();
    const { url } = env.clients[index];
    const auth = await authenticate(url, nodeKey(index + 1));
    const signed = await signAppSpec(buildAppSpec({ name: name('door'), ownerKey: owner }), 'fluxappregister', owner);
    const response = await fetch(`${url}/apps/appregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', zelidauth: auth.zelidauth, 'x-forwarded-for': `198.51.100.${index + 10}` },
      body: JSON.stringify(signed),
    });
    return { status: response.status, body: await response.json() };
  };

  const stubs = () => ({
    arcaneStub: getEnv().stubPeerClients.get(ARCANE_STUB),
    plainStub: getEnv().stubPeerClients.get(PLAIN_STUB),
  });

  return {
    async doorAdmitsOnlyOnArcaneNodes() {
      const answers = await Promise.all(REAL.map(async (index) => ({ index, ...(await registerThrough(index)) })));
      answers.forEach(({ index, status, body }) => {
        if (legacy.includes(index)) {
          expect(status, `legacy node ${index}: ${JSON.stringify(body)}`).to.equal(503);
          expect(body.data.name).to.equal('AdmissionUnavailable');
        } else {
          expect(body.status, `Arcane node ${index}: ${JSON.stringify(body)}`).to.equal('success');
        }
      });
      return answers.filter(({ body }) => body.status === 'success').map(({ body }) => body.data);
    },

    async everyNodeHolds(hashes) {
      const env = getEnv();
      await Promise.all(hashes.map((hash) => waitFor(async () => {
        const held = await Promise.all(REAL.map((i) => pendingMessageOn(env.clients[i], hash)));
        return held.every((doc) => doc !== null);
      }, { timeout: 90000, interval: 2000, label: `${hash} held by every node` })));
    },

    async signedCopyAfterAnUnsignedOneIsTaken() {
      const env = getEnv();
      const { arcaneStub, plainStub } = stubs();
      const app = await buildSeedableApp({ env, name: name('race'), instances: 1 });
      const message = pendingMessage(app, { clientTag: freshClientTag(), clientTagHeight: await currentTagHeight() });
      const mark = env.clients[observer].getLastEventId();

      await plainStub.broadcast(message);
      const refused = await admissionOf(env.clients[observer], app.hash, mark);
      expect(refused, JSON.stringify(refused)).to.include({ taken: false, reason: 'it did not arrive over an authenticated Arcane link' });

      const afterRefusal = env.clients[observer].getLastEventId();
      await arcaneStub.broadcast(message);
      const taken = await admissionOf(env.clients[observer], app.hash, afterRefusal);
      expect(taken, JSON.stringify(taken)).to.include({ taken: true });
    },

    async paidMessageThroughLegacyOnlyIsTaken() {
      const env = getEnv();
      const { plainStub } = stubs();
      const app = await buildSeedableApp({ env, name: name('paid'), instances: 1 });
      // only the plain stub can hand it over when the payment sends the observer asking
      await plainStub.loadMessage(app.permanentMessage);
      await queueAppTx(app.hash);
      await advanceBlock();
      await waitFor(async () => {
        const response = await env.clients[observer].get(`/apps/permanentmessages/${app.hash}?_=${Date.now()}`);
        return response.status === 'success' && response.data?.length > 0;
      }, { timeout: 120000, interval: 2000, label: 'the observer holds the paid message the plain stub served' });
    },

    async unpaidMessageThroughLegacyOnlyIsStoredNowhere() {
      const env = getEnv();
      const { plainStub } = stubs();
      const app = await buildSeedableApp({ env, name: name('unpaid'), instances: 1 });
      const message = pendingMessage(app, { clientTag: freshClientTag(), clientTagHeight: await currentTagHeight() });
      const mark = env.clients[observer].getLastEventId();

      await plainStub.broadcast(message);

      const refused = await admissionOf(env.clients[observer], app.hash, mark);
      expect(refused, JSON.stringify(refused)).to.include({ taken: false });
      const held = await Promise.all(arcane.map((i) => pendingMessageOn(env.clients[i], app.hash)));
      expect(held, 'Arcane nodes holding it').to.deep.equal(arcane.map(() => null));
    },
  };
}
