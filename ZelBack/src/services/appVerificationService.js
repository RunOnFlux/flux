/**
 * GetNodeIdentity | NodeBApp -> NodeB (so other end can get public pgp key)
 * NodeIdentitySent | NodeBApp -> NodeAApp
 * ChallengeRequest | NodeAApp -> NodeA (contains target ip, apiport via identity)
 * ChallengeCreated | NodeA (Gets pgp pubkey from ip apiport)
 * ChallengeSent | NodeAApp -> NodeBApp
 * ChallengeDecryptRequest | NodeBApp -> NodeB
 * ChallengeDecrypted | NodeB
 * DecryptedSent | NodeBApp -> NodeAApp
 * Verified | NodeAApp has now verified NodeBApp
 */

const config = require('config');
const dockerService = require('./dockerService');
const serviceHelper = require('./serviceHelper');
const pgpSerivce = require('./pgpService');
const messageHelper = require('./messageHelper');
const daemonServiceUtils = require('./daemonService/daemonServiceUtils')

const { randomBytes } = require('node:crypto');
const express = require('express');

let server = null;

async function generateChallengeMessage(req, res) {
  const parsedBody = serviceHelper.ensureObject(req.body);
  const { identity } = parsedBody;

  if (!identity) {
    res.statusMessage = "Authenticating node identity is required";
    res.status(422).end();
    return;
  }

  const app = await dockerService.getAppNameByContainerIp(req.socket.remoteAddress);
  if (!app) {
    res.statusMessage = "You are not authorized for this endpoint";
    res.status(403).end();
    return;
  }

  const fluxnode = daemonServiceUtils.executeCall("listfluxnodes", [identity.txhash]);

  if (!fluxnode) {
    res.statusMessage = 'Unable to find node identity in deterministicfluxnodelist'
    res.status(422).end();
    return;
  }

  // this is ridiculous having to do this all the time. The node identity should always include the port
  const [ip, apiport] = fluxnode.ip.includes(":") ? fluxnode.ip.split(":") : [fluxnode.ip, "16127"]

  const message = randomBytes(16).toString('hex');
  const toEncrypt = JSON.stringify({ app, message })

  // https://1-2-3-4-16127.node.api.runonflux.io/flux/pgp
  const hyphenEncodedHostname = `${ip.split(".").join("-")}-${apiport}`
  const pgpEndpoint = `http://${hyphenEncodedHostname}.node.api.runonflux.io/flux/pgp`

  const { data: pgpPubKeyRes } = await serviceHelper.axiosGet(pgpEndpoint, { timeout: 2000 })

  if (!pgpPubKeyRes?.status === "success") {
    res.statusMessage = "Unable to retrieve pgp key for target"
    res.status(422).end();
  }

  const encrypted = await pgpSerivce.encryptMessage(toEncrypt, [pgpPubKeyRes.data])

  const dataMessage = messageHelper.createDataMessage({ message, encrypted });
  return res ? res.json(dataMessage) : dataMessage;
}

async function getNodeIdentity(req, res) {
  const app = await dockerService.getAppNameByContainerIp(req.socket.remoteAddress);
  if (!app) {
    res.statusMessage = "You are not authorized for this endpoint";
    res.status(403).end();
    return;
  }

  let outPoint = null;
  try {
    // this is reliant on fluxd running
    const res = await generalService.obtainNodeCollateralInformation();
    outPoint = { txhash: res.txhash, outidx: res.txindex };
  } catch {
    log.error('Error getting collateral info from daemon.');
  }

  if (!outPoint) {
    res.statusMessage = 'Unable to get node identity.. try again later'
    res.status(503).end();
    return;
  }

  const message = messageHelper.createDataMessage(outPoint);

  return res ? res.json(message) : message;
}

async function decryptChallengeMessage(req, res) {
  const app = await dockerService.getAppNameByContainerIp(req.socket.remoteAddress);
  if (!app) {
    res.statusMessage = "You are not authorized for this endpoint";
    res.status(403).end();
    return;
  }

  const parsedBody = serviceHelper.ensureObject(req.body);
  const { encrypted } = parsedBody;

  if (!encrypted) {
    res.statusMessage = "Encrypted message not provided";
    res.status(422).end();
    return;
  }

  const pgpPrivateKey = userconfig.initial.pgpPrivateKey;

  if (!pgpPrivateKey) {
    res.statusMessage = "Pgp key not set"
    res.status(500).end();
    return;
  }

  const decrypted = await pgpSerivce.decryptMessage(encrypted, pgpPrivateKey)

  if (!decrypted) {
    res.statusMessage = "Unable to decrypt message";
    res.status(500).end();
  }

  const challenge = JSON.parse(decrypted);

  if (challenge.app !== app) {
    res.status(403).end();
    return;
  }

  const dataMessage = messageHelper.createDataMessage(challenge.message);
  return res ? res.json(dataMessage) : dataMessage;
}

function start() {
  if (server) return;

  const app = express();
  app.use(express.json());
  app.post("/createchallenge", generateChallengeMessage)
  app.post("/decryptchallenge", decryptChallengeMessage)
  app.get("/nodeindentity", getNodeIdentity)
  app.all('*', (_, res) => res.status(404).end());

  const bindAddress = config.server.appVerificationAddress;
  server = app.listen(80, bindAddress, () => {
    console.log(`Server listening on port: 80 address: ${bindAddress}`)
  });
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
}

module.exports = {
  start,
  stop,
};
