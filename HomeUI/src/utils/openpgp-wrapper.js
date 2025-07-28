// OpenPGP wrapper to handle WebCrypto availability gracefully
import './webcrypto-polyfill';

let openpgpModule = null;
let initializationError = null;

// Lazy load OpenPGP only when needed
export async function getOpenPGP() {
  if (initializationError) {
    throw initializationError;
  }

  if (openpgpModule) {
    return openpgpModule;
  }

  try {
    // Import OpenPGP dynamically
    const openpgp = await import('openpgp');

    // Configure OpenPGP to handle missing WebCrypto gracefully
    if (!window.crypto?.subtle) {
      console.warn('WebCrypto not available. OpenPGP functionality may be limited.');
      // You might want to configure OpenPGP to use alternative crypto implementations
      // if available in your version of OpenPGP.js
    }

    openpgpModule = openpgp;
    return openpgpModule;
  } catch (error) {
    console.error('Failed to initialize OpenPGP:', error);
    initializationError = new Error(`OpenPGP initialization failed: ${error.message}`);
    throw initializationError;
  }
}

// Export a proxy that will handle async loading
export default new Proxy({}, {
  get(target, prop) {
    return async (...args) => {
      const openpgp = await getOpenPGP();
      if (typeof openpgp[prop] === 'function') {
        return openpgp[prop](...args);
      }
      return openpgp[prop];
    };
  },
});
