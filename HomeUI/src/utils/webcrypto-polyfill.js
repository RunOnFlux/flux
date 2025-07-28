// WebCrypto polyfill for non-secure contexts
// This ensures OpenPGP.js can work in HTTP environments

if (typeof window !== 'undefined') {
  // Store original crypto object if it exists
  const originalCrypto = window.crypto;

  // Check if WebCrypto API is not available
  if (!window.crypto?.subtle) {
    console.warn('WebCrypto API not available. Setting up polyfill for OpenPGP.js compatibility.');

    // Ensure crypto object exists
    window.crypto = window.crypto || {};

    // Create a crypto.subtle stub that provides minimal functionality
    window.crypto.subtle = {
      generateKey: () => Promise.reject(new Error('WebCrypto not available in non-secure context. Please use HTTPS for full cryptographic functionality.')),
      importKey: () => Promise.reject(new Error('WebCrypto not available in non-secure context. Please use HTTPS for full cryptographic functionality.')),
      exportKey: () => Promise.reject(new Error('WebCrypto not available in non-secure context. Please use HTTPS for full cryptographic functionality.')),
      encrypt: () => Promise.reject(new Error('WebCrypto not available in non-secure context. Please use HTTPS for full cryptographic functionality.')),
      decrypt: () => Promise.reject(new Error('WebCrypto not available in non-secure context. Please use HTTPS for full cryptographic functionality.')),
      sign: () => Promise.reject(new Error('WebCrypto not available in non-secure context. Please use HTTPS for full cryptographic functionality.')),
      verify: () => Promise.reject(new Error('WebCrypto not available in non-secure context. Please use HTTPS for full cryptographic functionality.')),
      digest: () => Promise.reject(new Error('WebCrypto not available in non-secure context. Please use HTTPS for full cryptographic functionality.')),
      deriveBits: () => Promise.reject(new Error('WebCrypto not available in non-secure context. Please use HTTPS for full cryptographic functionality.')),
      deriveKey: () => Promise.reject(new Error('WebCrypto not available in non-secure context. Please use HTTPS for full cryptographic functionality.')),
      wrapKey: () => Promise.reject(new Error('WebCrypto not available in non-secure context. Please use HTTPS for full cryptographic functionality.')),
      unwrapKey: () => Promise.reject(new Error('WebCrypto not available in non-secure context. Please use HTTPS for full cryptographic functionality.')),
    };

    // Preserve other crypto properties
    if (originalCrypto) {
      Object.keys(originalCrypto).forEach((key) => {
        if (key !== 'subtle' && !(key in window.crypto)) {
          window.crypto[key] = originalCrypto[key];
        }
      });
    }
  }

  // Also check for global.crypto for Node.js compatibility in certain build environments
  if (typeof global !== 'undefined' && !global.crypto?.subtle) {
    global.crypto = global.crypto || {};
    global.crypto.subtle = window.crypto.subtle;
  }
}
