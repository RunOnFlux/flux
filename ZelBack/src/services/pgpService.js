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
    if (publicKey === userconfig.initial.publicKey && privateKey === userconfig.initial.privateKey) {
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
    apiport: ${Number(userconfig.initial.apiport || config.apiport)},
    pgpPrivateKey: '${privateKey}',
    pgpPublicKey: '${publicKey}',
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
    const existingPrivateKey = userconfig.initial.privateKey;
    const existingPublicKey = userconfig.initial.publicKey;
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

module.exports = {
  generateIdentity,
};
