const querystring = require('node:querystring');

const verificationHelper = require('../../services/verificationHelper');
const log = require('../log');

async function debugHandler(socket) {
  const { handshake: { query, address } } = socket;

  const { authDetails, roomName } = query;

  if (!authDetails || !roomName) {
    socket.emit('error', 'Unauthorized');
    log.info('Disconnecting GUI socket with missing details');
    socket.disconnect();
    return;
  }

  const parsed = querystring.decode(authDetails);

  const req = { headers: { zelidauth: parsed } };

  const ok = await verificationHelper.verifyPrivilege('adminandfluxteam', req);

  if (ok !== true) {
    socket.emit('error', 'Unauthorized');
    socket.disconnect();
    log.info('Disconnecting unauthorized GUI socket');
    return;
  }

  log.info(`New connection from: ${address}`);
  log.info(`Joining socket to room: ${roomName}`);

  socket.on('disconnect', () => log.info(`bye: ${address}`));
  socket.on('error', (err) => log.info(`socket err: ${err}`));

  socket.join(roomName);
}

module.exports = debugHandler;
