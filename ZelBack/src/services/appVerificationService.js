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
const log = require('../lib/log');
const dockerService = require('./dockerService');
const serviceHelper = require('./serviceHelper');
const pgpSerivce = require('./pgpService');
const messageHelper = require('./messageHelper');
const daemonServiceUtils = require('./daemonService/daemonServiceUtils');
const generalService = require('./generalService');

const { randomBytes } = require('node:crypto');
const express = require('express');

let server = null;

async function generateChallengeMessage(req, res) {
  const parsedBody = serviceHelper.ensureObject(req.body);
  const { identity } = parsedBody;

  if (!identity || identity.length !== 64) {
    res.statusMessage = 'Authenticating node identity is required (txid)';
    res.status(422).end();
    return;
  }

  const app = await dockerService.getAppNameByContainerIp(req.socket.remoteAddress);
  if (!app) {
    res.statusMessage = 'You are not authorized for this endpoint';
    res.status(403).end();
    return;
  }

  const fluxnodeRes = await daemonServiceUtils.executeCall('listfluxnodes', [identity]);

  if (!fluxnodeRes || fluxnodeRes.status !== 'success' || !fluxnodeRes.data.length) {
    res.statusMessage = 'Unable to find node identity in deterministicfluxnodelist';
    res.status(422).end();
    return;
  }

  // check if more than one?!?
  const fluxnode = fluxnodeRes.data[0];

  // this is ridiculous having to do this all the time. The node identity should always include the port
  const [ip, apiport] = fluxnode.ip.includes(':') ? fluxnode.ip.split(':') : [fluxnode.ip, '16127'];

  const message = randomBytes(16).toString('hex');
  const toEncrypt = JSON.stringify({ app, message });

  // https://1-2-3-4-16127.node.api.runonflux.io/flux/pgp
  const hyphenEncodedHostname = `${ip.split('.').join('-')}-${apiport}`;
  const pgpEndpoint = `http://${hyphenEncodedHostname}.node.api.runonflux.io/flux/pgp`;

  const { data: pgpPubKeyRes } = await serviceHelper.axiosGet(pgpEndpoint, { timeout: 2000 });

  if (!pgpPubKeyRes?.status === 'success') {
    res.statusMessage = 'Unable to retrieve pgp key for target';
    res.status(422).end();
  }

  const encrypted = await pgpSerivce.encryptMessage(toEncrypt, [pgpPubKeyRes.data]);

  const dataMessage = messageHelper.createDataMessage({ message, encrypted });
  res.json(dataMessage);
}

async function getNodeIdentity(req, res) {
  const app = await dockerService.getAppNameByContainerIp(req.socket.remoteAddress);
  if (!app) {
    res.statusMessage = 'You are not authorized for this endpoint';
    res.status(403).end();
    return;
  }

  let outPoint = null;
  try {
    // this is reliant on fluxd running
    const collateral = await generalService.obtainNodeCollateralInformation();
    outPoint = { txhash: collateral.txhash, outidx: collateral.txindex };
  } catch {
    log.error('Error getting collateral info from daemon.');
  }

  if (!outPoint) {
    res.statusMessage = 'Unable to get node identity.. try again later';
    res.status(503).end();
    return;
  }

  const message = messageHelper.createDataMessage(outPoint);
  res.json(message);
}

async function decryptChallengeMessage(req, res) {
  const app = await dockerService.getAppNameByContainerIp(req.socket.remoteAddress);
  if (!app) {
    res.statusMessage = 'You are not authorized for this endpoint';
    res.status(403).end();
    return;
  }

  const parsedBody = serviceHelper.ensureObject(req.body);
  const { encrypted } = parsedBody;

  if (!encrypted) {
    res.statusMessage = 'Encrypted message not provided';
    res.status(422).end();
    return;
  }

  // eslint-disable-next-line no-undef
  const { pgpPrivateKey } = userconfig.initial;

  if (!pgpPrivateKey) {
    res.statusMessage = 'Pgp key not set';
    res.status(500).end();
    return;
  }

  const decrypted = await pgpSerivce.decryptMessage(encrypted, pgpPrivateKey);

  if (!decrypted) {
    res.statusMessage = 'Unable to decrypt message';
    res.status(500).end();
  }

  const challenge = JSON.parse(decrypted);

  if (challenge.app !== app) {
    res.status(403).end();
    return;
  }

  const dataMessage = messageHelper.createDataMessage(challenge.message);
  res.json(dataMessage);
}

function handleError(middleware, req, res, next) {
  middleware(req, res, (err) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      res.statusMessage = err.message;
      return res.sendStatus(400);
    }
    else if (err) {
      log.error(err);
      return res.sendStatus(400);
    }

    next();
  });
}

function start() {
  if (server) return;

  const app = express();
  app.use((req, res, next) => {
    handleError(express.json(), req, res, next);
  });
  app.post('/createchallenge', generateChallengeMessage);
  app.post('/decryptchallenge', decryptChallengeMessage);
  app.get('/nodeidentity', getNodeIdentity);
  app.all('*', (_, res) => res.status(404).end());

  const bindAddress = config.server.appVerificationAddress;
  server = app.listen(80, bindAddress, () => {
    log.info(`Server listening on port: 80 address: ${bindAddress}`);
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
