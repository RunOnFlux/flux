/**
 * PGP worker - runs one openpgp operation for pgpService.
 *
 * openpgp holds ~19MB (largely WASM linear memory) from the moment it is
 * required, and a node needs it for one identity check at boot plus the secrets
 * of the handful of v7 apps that still carry PGP-encrypted fields - v8 and
 * later keep theirs inside the enterprise blob, which uses node's own crypto.
 * Requiring it here, in a worker spawned per operation and terminated after it,
 * keeps that memory out of the main isolate.
 */

const { parentPort } = require('worker_threads');
const openpgp = require('openpgp');

const operations = {
  async derivePublicKey({ armoredPrivateKey }) {
    const privateKey = await openpgp.readPrivateKey({ armoredKey: armoredPrivateKey });
    return privateKey.toPublic().armor();
  },

  async generateKey({ name, email }) {
    const keypair = await openpgp.generateKey({
      type: 'ecc',
      curve: 'curve25519',
      userIDs: [{ name, email }],
      passphrase: '',
      format: 'armored',
    });
    return { privateKey: keypair.privateKey, publicKey: keypair.publicKey };
  },

  async encrypt({ message, encryptionKeys }) {
    const publicKeys = await Promise.all(
      encryptionKeys.map((armoredKey) => openpgp.readKey({ armoredKey })),
    );
    return openpgp.encrypt({
      message: await openpgp.createMessage({ text: message }),
      encryptionKeys: publicKeys,
    });
  },

  async decrypt({ encryptedMessage, decryptionKey }) {
    const messageEncrypted = await openpgp.readMessage({ armoredMessage: encryptedMessage });
    const privateKey = await openpgp.readPrivateKey({ armoredKey: decryptionKey });
    const decryptedMessage = await openpgp.decrypt({
      message: messageEncrypted,
      decryptionKeys: privateKey,
    });
    return decryptedMessage.data;
  },
};

parentPort.on('message', async (payload) => {
  try {
    const { operation, params } = payload;

    const run = operations[operation];
    if (!run) throw new Error(`Unsupported PGP operation: ${operation}`);

    parentPort.postMessage({ ok: true, result: await run(params || {}) });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error.message || String(error) });
  }
});
