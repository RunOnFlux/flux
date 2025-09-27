const crypto = require('crypto');
const log = require('../../lib/log');

/**
 * Decrypt data with AES session key
 * @param {string} appName - Application name
 * @param {string} base64NonceCiphertextTag - Base64 encoded nonce+ciphertext+tag
 * @param {string} base64AesKey - Base64 encoded AES key
 * @returns {string|null} Decrypted data or null if failed
 */
function decryptWithAesSession(appName, base64NonceCiphertextTag, base64AesKey) {
  try {
    // Decode the base64 inputs
    const nonceCiphertextTag = Buffer.from(base64NonceCiphertextTag, 'base64');
    const aesKey = Buffer.from(base64AesKey, 'base64');

    // Extract components (assuming 12-byte nonce, 16-byte tag)
    const nonce = nonceCiphertextTag.slice(0, 12);
    const tag = nonceCiphertextTag.slice(-16);
    const ciphertext = nonceCiphertextTag.slice(12, -16);

    // Create decipher
    const decipher = crypto.createDecipherGCM('aes-256-gcm');
    decipher.setAutoPadding(false);

    // Set the IV (nonce) and auth tag
    decipher.setAuthTag(tag);

    // Decrypt
    let decrypted = decipher.update(ciphertext, null, 'utf8');
    decrypted += decipher.final('utf8');

    log.info(`Successfully decrypted data for app: ${appName}`);
    return decrypted;
  } catch (error) {
    log.error(`Error decrypting data for app ${appName}: ${error.message}`);
    return null;
  }
}

/**
 * Encrypt data with AES session key
 * @param {string} appName - Application name
 * @param {string} dataToEncrypt - Data to encrypt
 * @param {string} base64AesKey - Base64 encoded AES key
 * @returns {string|null} Base64 encoded encrypted data or null if failed
 */
function encryptWithAesSession(appName, dataToEncrypt, base64AesKey) {
  try {
    // Decode the AES key
    const aesKey = Buffer.from(base64AesKey, 'base64');

    // Generate a random nonce (12 bytes for GCM)
    const nonce = crypto.randomBytes(12);

    // Create cipher
    const cipher = crypto.createCipherGCM('aes-256-gcm');
    cipher.setAutoPadding(false);

    // Encrypt the data
    let ciphertext = cipher.update(dataToEncrypt, 'utf8');
    ciphertext = Buffer.concat([ciphertext, cipher.final()]);

    // Get the authentication tag
    const tag = cipher.getAuthTag();

    // Combine nonce + ciphertext + tag
    const combined = Buffer.concat([nonce, ciphertext, tag]);

    // Return as base64
    const result = combined.toString('base64');
    log.info(`Successfully encrypted data for app: ${appName}`);
    return result;
  } catch (error) {
    log.error(`Error encrypting data for app ${appName}: ${error.message}`);
    return null;
  }
}

/**
 * Generate a random AES-256 key
 * @returns {string} Base64 encoded AES key
 */
function generateAesKey() {
  const key = crypto.randomBytes(32); // 256 bits
  return key.toString('base64');
}

/**
 * Validate encrypted app data format
 * @param {string} encryptedData - Base64 encoded encrypted data
 * @returns {boolean} True if format is valid
 */
function validateEncryptedDataFormat(encryptedData) {
  try {
    const buffer = Buffer.from(encryptedData, 'base64');
    // Minimum size: 12 (nonce) + 16 (tag) + 1 (at least 1 byte data) = 29 bytes
    return buffer.length >= 29;
  } catch (error) {
    return false;
  }
}

module.exports = {
  decryptWithAesSession,
  encryptWithAesSession,
  generateAesKey,
  validateEncryptedDataFormat,
};