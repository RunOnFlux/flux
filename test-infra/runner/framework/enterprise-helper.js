import crypto from 'node:crypto';

// Must match the key returned by the fluxbenchd stub's decryptrsamessage handler
const TEST_AES_KEY = Buffer.from('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', 'base64');

/**
 * Build an enterprise blob for a test app.
 *
 * Structure: [256 bytes RSA block][nonce (12)][ciphertext][auth tag (16)]
 *
 * The RSA block is random padding — the stub ignores it and returns
 * the known AES key. The AES-GCM portion is real encryption using
 * that same key, so FluxOS decrypts it normally.
 */
export function buildEnterpriseBlob(compose, contacts = []) {
  const payload = JSON.stringify({ compose, contacts });

  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', TEST_AES_KEY, nonce);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const fakeRsaBlock = crypto.randomBytes(256);
  return Buffer.concat([fakeRsaBlock, nonce, encrypted, tag]).toString('base64');
}
