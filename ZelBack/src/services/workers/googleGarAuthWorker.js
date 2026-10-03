/**
 * Google GAR auth worker - mints an OAuth access token for a service account.
 *
 * google-auth-library is required here, at the top of a worker spawned for a
 * single exchange and terminated after it, so the main isolate never carries
 * it. The expiry the provider needs lives on the client after the call, so it
 * is read here and returned alongside the token.
 */

const { parentPort } = require('worker_threads');
// eslint-disable-next-line import/no-unresolved
const { JWT } = require('google-auth-library');

parentPort.on('message', async (payload) => {
  try {
    const { clientEmail, privateKey, scopes } = payload;

    const jwtClient = new JWT({ email: clientEmail, key: privateKey, scopes });
    const tokens = await jwtClient.getAccessToken();

    parentPort.postMessage({
      ok: true,
      result: {
        token: tokens ? tokens.token : null,
        expiryDate: jwtClient.credentials ? jwtClient.credentials.expiry_date : null,
      },
    });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error.message || String(error) });
  }
});
