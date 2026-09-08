const verificationHelper = require('../../services/verificationHelper');
const log = require('../log');
const { Privilege } = require('../../services/utils/privileges');

async function debugHandler(socket) {
  const { handshake: { query, address } } = socket;

  const { authDetails, roomName } = query;

  if (!authDetails || !roomName) {
    socket.emit('error', 'Unauthorized');
    log.info('Disconnecting GUI socket with missing details');
    socket.disconnect();
    return;
  }

  // authDetails is the query string the client sent, which is the same form a
  // zelidauth header takes. There is no request here to take it from, and there
  // never was - the one this built existed only to fit a signature.
  const ok = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authDetails)
    .catch((error) => {
      // A throw in a socket.io listener is unhandled and takes the process down.
      log.error(error);
      return false;
    });

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
