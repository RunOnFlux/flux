import crypto from 'node:crypto';
import { signAsync, getPublicKey } from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/ripemd160.js';

function hash256(data) {
  return sha256(sha256(data));
}

function encodeVarint(n) {
  if (n < 253) return Buffer.from([n]);
  const buf = Buffer.alloc(3);
  buf[0] = 0xfd;
  buf.writeUInt16LE(n, 1);
  return buf;
}

function btcMagicHash(message) {
  const prefix = Buffer.from('\x18Bitcoin Signed Message:\n', 'utf8');
  const messageBuffer = Buffer.from(message, 'utf8');
  const varint = encodeVarint(messageBuffer.length);
  return hash256(Buffer.concat([prefix, varint, messageBuffer]));
}

async function signBtcMessage(message, privkeyHex, compressed = true) {
  const hash = btcMagicHash(message);
  const sig = await signAsync(hash, privkeyHex, { lowS: true });

  const flag = 27 + sig.recovery + (compressed ? 4 : 0);

  const out = Buffer.alloc(65);
  out[0] = flag;
  Buffer.from(sig.toCompactRawBytes()).copy(out, 1);

  return out.toString('base64');
}

function privkeyToZelid(privkeyHex) {
  const pubBytes = getPublicKey(privkeyHex, true);
  const h = ripemd160(sha256(pubBytes));
  const versioned = Buffer.concat([Buffer.from([0x00]), Buffer.from(h)]);
  const checksum = sha256(sha256(versioned)).slice(0, 4);
  const data = Buffer.concat([versioned, Buffer.from(checksum)]);

  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = BigInt('0x' + Buffer.from(data).toString('hex'));
  let encoded = '';
  while (num > 0n) {
    encoded = ALPHABET[Number(num % 58n)] + encoded;
    num = num / 58n;
  }
  for (let i = 0; i < data.length && data[i] === 0; i++) encoded = '1' + encoded;

  return encoded;
}

export async function authenticate(nodeUrl, keypair) {
  const { privkey, zelid } = keypair;

  const phraseRes = await fetch(`${nodeUrl}/id/loginphrase`);
  const phraseData = await phraseRes.json();

  if (phraseData.status !== 'success') {
    throw new Error(`Failed to get login phrase: ${JSON.stringify(phraseData)}`);
  }

  const loginPhrase = phraseData.data;
  const signature = await signBtcMessage(loginPhrase, privkey);

  const verifyRes = await fetch(`${nodeUrl}/id/verifylogin`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ zelid, loginPhrase, signature }),
  });

  const verifyData = await verifyRes.json();

  if (verifyData.status !== 'success') {
    throw new Error(`Failed to verify login: ${JSON.stringify(verifyData)}`);
  }

  const zelidauth = JSON.stringify({ zelid, loginPhrase, signature });
  return { zelidauth, zelid, loginPhrase, signature };
}

export { signBtcMessage, privkeyToZelid };
