const verificationHelper = require('../../services/verificationHelper');

async function debugHandler(socket) {
  const { handshake: { query, address } } = socket;

  const { authDetails, roomName } = query;

  if (!authDetails || !roomName) {
    socket.emit('error', 'Unauthorized');
    socket.disconnect();
    return;
  }

  const ok = await verificationHelper.verifyPrivilege('adminandfluxteam', authDetails);

  if (ok !== true) {
    socket.emit('error', 'Unauthorized');
    socket.disconnect();
    return;
  }

  console.log('new connection from', address);
  console.log('joining socket to room:', roomName);

  socket.on('disconnect', () => console.log('bye', address));
  socket.on('error', (err) => console.log('socket err', err));

  socket.join(query.roomName);
}

module.exports = debugHandler;
