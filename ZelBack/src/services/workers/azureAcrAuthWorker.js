/**
 * Azure ACR auth worker - obtains an Azure AD access token for a service principal.
 *
 * This is the only step of the ACR flow that needs @azure/identity; the refresh
 * and access token exchanges that follow it are plain HTTPS and stay in the
 * provider. The SDK is required here, at the top of a worker that is spawned per
 * exchange and terminated after it, so the main isolate never carries it.
 */

const { parentPort } = require('worker_threads');
// eslint-disable-next-line import/no-unresolved
const { ClientSecretCredential } = require('@azure/identity');

parentPort.on('message', async (payload) => {
  try {
    const {
      tenantId, clientId, clientSecret, scopes,
    } = payload;

    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const tokenResponse = await credential.getToken(scopes);

    // Only the fields the provider consumes cross the boundary - the credential
    // object itself holds live handles that mean nothing outside this worker.
    const result = tokenResponse
      ? { token: tokenResponse.token, expiresOnTimestamp: tokenResponse.expiresOnTimestamp }
      : null;

    parentPort.postMessage({ result });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});
