const crypto = require('node:crypto');
const tls = require('node:tls');

const DEVICE_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * The Luhn mod 32 check character syncthing appends to each 13-character group
 * of a device ID.
 * @param {string} group
 * @returns {string}
 */
function deviceIdCheckCharacter(group) {
  let factor = 1;
  let sum = 0;
  for (const character of group) {
    const addend = factor * DEVICE_ID_ALPHABET.indexOf(character);
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / 32) + (addend % 32);
  }
  return DEVICE_ID_ALPHABET[(32 - (sum % 32)) % 32];
}

/**
 * `value` as syncthing writes a device ID - upper case, each 13-character group
 * followed by its check character, a dash after every 7 - when it is one as
 * syncthing reads one: base32, dashes and spaces aside and 0, 1 and 8 read as
 * O, I and B, either 56 characters whose every 14th is the check character of
 * the 13 before it, or 52 without them. Syncthing refuses a configuration that
 * names any other device, and with it every device the same write configures,
 * and it holds every device under this form, so an ID compared with its
 * configuration is compared in it.
 * @param {unknown} value
 * @returns {string|null} null when `value` is not a device ID
 */
function canonicalSyncthingDeviceId(value) {
  if (typeof value !== 'string') return null;
  const id = value.replace(/[-\s]/g, '').toUpperCase()
    .replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');
  if (![...id].every((character) => DEVICE_ID_ALPHABET.includes(character))) return null;
  let checked;
  if (id.length === 52) {
    checked = [0, 13, 26, 39].map((start) => {
      const group = id.slice(start, start + 13);
      return group + deviceIdCheckCharacter(group);
    }).join('');
  } else if (id.length === 56) {
    for (let start = 0; start < 56; start += 14) {
      if (id[start + 13] !== deviceIdCheckCharacter(id.slice(start, start + 13))) return null;
    }
    checked = id;
  } else {
    return null;
  }
  return checked.match(/.{7}/g).join('-');
}

/**
 * The device ID of a syncthing certificate: the SHA-256 of its DER encoding in
 * unpadded base32, in syncthing's written form.
 * @param {Buffer} der
 * @returns {string}
 */
function deviceIdOfCertificate(der) {
  const digest = crypto.createHash('sha256').update(der).digest();
  let bits = 0;
  let value = 0;
  let encoded = '';
  for (const byte of digest) {
    value = (value << 8) | byte; // eslint-disable-line no-bitwise
    bits += 8;
    while (bits >= 5) {
      encoded += DEVICE_ID_ALPHABET[(value >>> (bits - 5)) & 31]; // eslint-disable-line no-bitwise
      bits -= 5;
    }
  }
  if (bits > 0) encoded += DEVICE_ID_ALPHABET[(value << (5 - bits)) & 31]; // eslint-disable-line no-bitwise
  return canonicalSyncthingDeviceId(encoded);
}

/**
 * The device a syncthing listener proves it is. In TLS 1.3 the server signs the
 * handshake with the key of the certificate it presents, so a completed
 * handshake proves the listener holds that certificate's private key: a copied
 * certificate without its key cannot complete one.
 * @param {string} host
 * @param {number} port The listener's syncthing (BEP) port.
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<string|null>} The proven device ID, or null when no
 *   handshake completed.
 */
function presentedDeviceId(host, port, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (deviceId) => {
      if (settled) return;
      settled = true;
      // eslint-disable-next-line no-use-before-define
      socket.destroy();
      resolve(deviceId);
    };
    const socket = tls.connect({
      host,
      port,
      // syncthing's certificates are self-signed; the device ID is the identity
      rejectUnauthorized: false,
      ALPNProtocols: ['bep/1.0'],
      minVersion: 'TLSv1.3',
      servername: 'syncthing',
      timeout: timeoutMs,
    });
    socket.once('secureConnect', () => {
      const { raw } = socket.getPeerCertificate(false);
      finish(raw ? deviceIdOfCertificate(raw) : null);
    });
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
  });
}

module.exports = {
  canonicalSyncthingDeviceId,
  deviceIdOfCertificate,
  presentedDeviceId,
};
