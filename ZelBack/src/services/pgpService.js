const config = require('config');
const path = require('path');
const fs = require('fs').promises;
const openpgp = require('openpgp');

const generalService = require('./generalService');

const log = require('../lib/log');
const userconfig = require('../../../config/userconfig');

/**
 * To adjust PGP identity
 * @param {string} privateKey Armored version of private key
 * @param {string} publicKey Armored version of public key
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function adjustPGPidentity(privateKey, publicKey) {
  try {
    const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
    if (publicKey === userconfig.initial.pgpPublicKey && privateKey === userconfig.initial.pgpPrivateKey) {
      return;
    }
    log.info(`Adjusting Identity to ${publicKey}`);
    const dataToWrite = `module.exports = {
  initial: {
    ipaddress: '${userconfig.initial.ipaddress || '127.0.0.1'}',
    zelid: '${userconfig.initial.zelid || config.fluxTeamZelId}',
    kadena: '${userconfig.initial.kadena || ''}',
    testnet: ${userconfig.initial.testnet || false},
    development: ${userconfig.initial.development || false},
    apiport: ${Number(userconfig.initial.apiport || config.server.apiport)},
    pgpPrivateKey: \`${privateKey}\`,
    pgpPublicKey: \`${publicKey}\`,
    blockedPorts: '${userconfig.initial.blockedPorts || []}',
  }
}`;

    await fs.writeFile(fluxDirPath, dataToWrite);
  } catch (error) {
    log.error(error);
  }
}

/**
 * To check if correct pgp identity exists
 */
async function identityExists() {
  try {
    // only generate new identity if private key or public key is missing, do not match
    const existingPrivateKey = userconfig.initial.pgpPrivateKey;
    const existingPublicKey = userconfig.initial.pgpPublicKey;
    if (existingPrivateKey && existingPublicKey) {
      // check if public key belongs to our private key
      const privateKey = await openpgp.readPrivateKey({ armoredKey: existingPrivateKey });
      const publicKey = privateKey.toPublic().armor();
      if (publicKey !== existingPublicKey) {
        log.warn('Existing PGP identity is corrupted. Generating new identity');
        return false;
      }
      return true;
    }
    log.info('PGP identity does not exist. Proceeding with generation');
    return false;
  } catch (error) {
    log.error(error);
    log.info('PGP identity error. Generating new identity');
    return false;
  }
}

/**
 * To generate and store new identity
 */
async function generateIdentity() {
  try {
    const currentIdentityExists = await identityExists();
    if (currentIdentityExists) {
      return;
    }
    const collateralInfo = await generalService.obtainNodeCollateralInformation();
    // userId name is our txid:outputid
    // userId email is our zelid@runonflux.io
    const email = `${userconfig.initial.zelid}@runonflux.io`; // 1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC@runonflux.io
    const name = `${collateralInfo.txhash}:${collateralInfo.txindex}`; // '0000000567ad22d02e3fc7631d94eb0dac5f1d5eb4adbd63349766f2665640c6:0'
    const keypair = await openpgp.generateKey({
      type: 'ecc', // Type of the key, defaults to ECC
      curve: 'curve25519', // ECC curve name, defaults to curve25519
      userIDs: [{ name, email }], // you can pass multiple user IDs
      passphrase: '', // no password
      format: 'armored', // output key format, defaults to 'armored' (other options: 'binary' or 'object')
    });
    await adjustPGPidentity(keypair.privateKey, keypair.publicKey);
    log.info('PGP identity generated');
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
    const publicKeys = await Promise.all(encryptionKeys.map((armoredKey) => openpgp.readKey({ armoredKey })));

    const pgpMessage = await openpgp.createMessage({ text: message });
    const encryptedMessage = await openpgp.encrypt({
      message: pgpMessage, // input as Message object
      encryptionKeys: publicKeys,
    });
    // '-----BEGIN PGP MESSAGE ... END PGP MESSAGE-----'
    return encryptedMessage;
  } catch (error) {
    log.error(error);
    return null;
  }
}

/**
 * To decrypt a message with an armored private key
 * @param {string} encryptedMessage Message to encrypt
 * @param {string} decryptionKey Armored version of private key
 * @returns {string} Return plain text message
 */
async function decryptMessage(encryptedMessage, decryptionKey = userconfig.initial.pgpPrivateKey) {
  try {
    const messageEncrypted = await openpgp.readMessage({
      armoredMessage: encryptedMessage, // parse armored message
    });
    const privateKey = await openpgp.readPrivateKey({ armoredKey: decryptionKey });
    const decryptedMessage = await openpgp.decrypt({
      message: messageEncrypted,
      decryptionKeys: privateKey,
    });
    return decryptedMessage.data;
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
