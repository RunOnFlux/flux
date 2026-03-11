const WebSocket = require('ws');

let currentId = 0;

/**
 * Call flux-configd RPC method via WebSocket over Unix socket
 * @param {string} method - RPC method name (e.g., 'arcane.generate_challenge')
 * @param {object} params - RPC parameters object
 * @returns {Promise<any>} Result from flux-configd
 * @throws {Error} If RPC call fails
 */
async function callFluxConfigdRPC(method, params = {}) {
  const connectionUri = process.env.FLUX_CONFIG_CONNECTION;
  if (!connectionUri) {
    throw new Error('flux-configd not available (FLUX_CONFIG_CONNECTION not set)');
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws+${connectionUri}`);

    const id = currentId;
    currentId = (currentId + 1) % 1000000;

    const request = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    let authenticated = false;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('flux-configd RPC timeout'));
    }, 10000);

    ws.on('open', () => {
      // flux-configd requires an auth handshake before accepting RPC calls
      ws.send(JSON.stringify({ api_key: '' }));
    });

    ws.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString());

        // Wait for auth confirmation, then send the RPC request
        if (!authenticated) {
          if (response.authenticated) {
            authenticated = true;
            ws.send(JSON.stringify(request));
          }
          return;
        }

        // Ignore non-JSON-RPC messages (e.g. state broadcasts)
        if (response.jsonrpc !== '2.0' || response.id !== id) {
          return;
        }

        clearTimeout(timeout);
        ws.close();

        if (response.error) {
          const error = new Error(response.error.message || 'RPC error');
          error.code = response.error.code;
          reject(error);
          return;
        }

        resolve(response.result);
      } catch (err) {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`Failed to parse flux-configd response: ${err.message}`));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`flux-configd connection error: ${err.message}`));
    });

    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      if (code !== 1000) {
        reject(new Error(`flux-configd connection closed: ${code} ${reason}`));
      }
    });
  });
}

module.exports = {
  callFluxConfigdRPC,
};
