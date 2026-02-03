const WebSocket = require('ws');
const config = require('config');

let currentId = 0;

/**
 * Call flux-configd RPC method via WebSocket over Unix socket
 * @param {string} method - RPC method name (e.g., 'arcane.generate_challenge')
 * @param {object} params - RPC parameters object
 * @returns {Promise<any>} Result from flux-configd
 * @throws {Error} If RPC call fails
 */
async function callFluxConfigdRPC(method, params = {}) {
  const socketPath = config.fluxconfigd.socketPath;

  return new Promise((resolve, reject) => {
    // Create WebSocket connection to Unix socket
    const ws = new WebSocket(`ws+unix://${socketPath}`);

    const id = currentId;
    currentId = (currentId + 1) % 1000000;

    const request = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('flux-configd RPC timeout'));
    }, 10000);

    ws.on('open', () => {
      ws.send(JSON.stringify(request));
    });

    ws.on('message', (data) => {
      clearTimeout(timeout);
      ws.close();

      try {
        const response = JSON.parse(data.toString());

        if (response.error) {
          const error = new Error(response.error.message || 'RPC error');
          error.code = response.error.code;
          reject(error);
          return;
        }

        resolve(response.result);
      } catch (err) {
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
