const config = require('config');
const path = require('path');
const fs = require('fs').promises;
const generalService = require('./generalService');
const workerRunner = require('./utils/workerRunner');
const configManager = require('./utils/configManager');
const log = require('../lib/log');

const runPgp = (operation, params) => workerRunner.runInWorker('pgpWorker', { operation, params });

/**
 * To adjust PGP identity. The file is this node's only record of its keypair,
 * so the in-process copy is refreshed from it here. A caller that stores an
 * identity and then reads the previous one back cannot tell that the write
 * happened, and every other writer of this file rebuilds it from the same
 * in-process copy - so a stale one puts the replaced keypair straight back.
 * @param {string} privateKey Armored version of private key
 * @param {string} publicKey Armored version of public key
 * @returns {Promise<void>} Rejects if the identity could not be stored.
 */
async function adjustPGPidentity(privateKey, publicKey) {
  const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
  if (publicKey === userconfig.initial.pgpPublicKey && privateKey === userconfig.initial.pgpPrivateKey) {
    return;
  }
  log.info(`Adjusting Identity to ${publicKey}`);
  const dataToWrite = `module.exports = {
  initial: {
    ipaddress: '${userconfig.initial.ipaddress || '127.0.0.1'}',
    zelid: '${userconfig.initial.zelid || config.fluxTeamFluxID}',
    kadena: '${userconfig.initial.kadena || ''}',
    testnet: ${userconfig.initial.testnet || false},
    development: ${userconfig.initial.development || false},
    apiport: ${Number(userconfig.initial.apiport || config.server.apiport)},
    routerIP: '${userconfig.initial.routerIP || ''}',
    pgpPrivateKey: \`${privateKey}\`,
    pgpPublicKey: \`${publicKey}\`,
    blockedPorts: ${JSON.stringify(userconfig.initial.blockedPorts || [])},
    blockedRepositories: ${JSON.stringify(userconfig.initial.blockedRepositories || []).replace(/"/g, "'")},
  }
}`;

  await fs.writeFile(fluxDirPath, dataToWrite);
  configManager.reloadConfig();
}

/**
 * The private key this node has already been shown to hold the public half of.
 * @type {string | null}
 */
let verifiedPrivateKey = null;

/**
 * The identity repair that is running, if any. Every caller relying on the
 * private key meets the same corrupt pair, and a repair rewrites
 * config/userconfig.js whole - a file that is emptied before it is written, and
 * that a reader landing mid-write finds carrying no identity at all. Callers
 * share one repair rather than each running theirs over the top of the others.
 * @type {Promise<void> | null}
 */
let repairInFlight = null;

/**
 * @returns {void}
 */
function clearRepairInFlight() {
  repairInFlight = null;
}

/**
 * To generate a keypair and store it as this node's identity
 * @returns {Promise<void>}
 */
async function createIdentity() {
  const collateralInfo = await generalService.obtainNodeCollateralInformation();
  // userId name is our txid:outputid
  // userId email is our zelid@runonflux.io
  const email = `${userconfig.initial.zelid}@runonflux.io`; // 1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC@runonflux.io
  const name = `${collateralInfo.txhash}:${collateralInfo.txindex}`; // '0000000567ad22d02e3fc7631d94eb0dac5f1d5eb4adbd63349766f2665640c6:0'
  const keypair = await runPgp('generateKey', { name, email });
  await adjustPGPidentity(keypair.privateKey, keypair.publicKey);
  // the halves were generated together, so the check this saves has one answer
  verifiedPrivateKey = keypair.privateKey;
  log.info('PGP identity generated');
}

/**
 * To replace the stored keypair if the public key does not belong to the
 * private key. Anything encrypted to a public key whose private half we do not
 * hold is unreadable, so a mismatch is repaired rather than reported.
 *
 * A pair is written by adjustPGPidentity in one go and does not drift, so this
 * guards against the config file having been corrupted or hand-edited. It runs
 * when the private key is first relied on rather than at boot, because every
 * openpgp operation costs a worker and a fresh load of the library - the entire
 * cost of the check - and the answer for a key that has not changed is known.
 * @returns {Promise<void>}
 */
async function ensureIdentityVerified() {
  try {
    const privateKey = userconfig.initial.pgpPrivateKey;
    const publicKey = userconfig.initial.pgpPublicKey;
    if (!privateKey || !publicKey || verifiedPrivateKey === privateKey) return;

    const derived = await runPgp('derivePublicKey', { armoredPrivateKey: privateKey });
    if (derived === publicKey) {
      verifiedPrivateKey = privateKey;
      return;
    }

    if (!repairInFlight) {
      log.warn('Existing PGP identity is corrupted. Generating new identity');
      log.warn('Whatever was sealed to the previous public key was never readable here and has to be published again');
      repairInFlight = createIdentity().finally(clearRepairInFlight);
    }
    await repairInFlight;
  } catch (error) {
    // an identity that could not be checked is not a reason to refuse the work
    // that prompted the check - a genuinely broken key fails the decrypt itself
    log.error(error);
  }
}

/**
 * To give the node a PGP identity if it does not have one. A node that already
 * carries a keypair needs nothing here - the pair is verified by
 * ensureIdentityVerified when something first relies on it, so boot neither
 * loads openpgp nor waits for it.
 * @returns {Promise<void>}
 */
async function generateIdentity() {
  try {
    if (userconfig.initial.pgpPrivateKey && userconfig.initial.pgpPublicKey) return;

    log.info('PGP identity does not exist. Proceeding with generation');
    await createIdentity();
  } catch (error) {
    log.error('Identity generation error');
    log.error(error);
  }
}

/**
 * To encrypt a message with an array of encryption public keys
 * @param {string} message Message to encrypt
 * @param {array} encryptionKeys Armored version of array of public key
 * @returns {string} Return armored version of encrypted message
 */
async function encryptMessage(message, encryptionKeys) {
  try {
    // '-----BEGIN PGP MESSAGE ... END PGP MESSAGE-----'
    return await runPgp('encrypt', { message, encryptionKeys });
  } catch (error) {
    log.error(error);
    return null;
  }
}

/**
 * To decrypt a message with an armored private key
 * @param {string} encryptedMessage Message to encrypt
 * @param {string} decryptionKey Armored version of private key
 * @returns {Promise<string>} Return plain text message
 */
async function decryptMessage(encryptedMessage, decryptionKey = null) {
  try {
    // this node's own key is the one that could be corrupt, so it is checked
    // before it is used; a caller supplying a key has vouched for it already
    if (!decryptionKey) await ensureIdentityVerified();

    const key = decryptionKey ?? userconfig.initial.pgpPrivateKey;

    return await runPgp('decrypt', { encryptedMessage, decryptionKey: key });
  } catch (error) {
    log.error(error);
    return null;
  }
}

module.exports = {
  generateIdentity,
  encryptMessage,
  decryptMessage,
};
