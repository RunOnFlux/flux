const socketio = require('socket.io');
const verificationHelperUtils = require('../services/verificationHelperUtils');
const dockerService = require('../services/dockerService');
const serviceHelper = require('../services/serviceHelper');

const log = require('../../../lib/log');

let io;

function initIO(httpServer) {
  io = socketio(httpServer, {
    transports: ['websocket', 'polling', 'flashsocket'],
    allowEIO3: true,
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    socket.on('exec', async (zelidauth, nameOrId, dockerCmd, dockerEnv, dockerUser) => {
      const auth = {
        zelidauth,
      };
      const container = await dockerService.getDockerContainerByIdOrName(nameOrId);
      const mainAppName = nameOrId.split('_')[1] || nameOrId;
      const authorized = await verificationHelperUtils.verifyAppOwnerSession(auth, mainAppName);
      if (authorized !== true) {
        socket.emit('error', 'Not authorized.');
        return;
      }
      if (!container) {
        socket.emit('error', 'Container not found.');
        return;
      }
      const cmd = {
        AttachStdout: true,
        AttachStderr: true,
        AttachStdin: true,
        Tty: true,
        Cmd: serviceHelper.commandStringToArray(dockerCmd),
        Env: serviceHelper.commandStringToArray(dockerEnv),
        User: dockerUser,
      };
      container.exec(cmd, (err, exec) => {
        const options = {
          Tty: true,
          stream: true,
          stdin: true,
          stdout: true,
          stderr: true,
          hijack: true,
        };
        socket.on('resize', (data) => {
          const { rows, cols } = data;
          exec.resize({ h: rows, w: cols }, () => {
          });
        });
        /* eslint-disable no-shadow */
        exec.start(options, (err, stream) => {
          if (err) {
            log.error(err);
            // socket.emit('error', 'Error executing the command.');
            return;
          }
          stream.on('data', (chunk) => {
            socket.emit('show', chunk.toString());
          });

          socket.on('cmd', (data) => {
            if (typeof data !== 'object') {
              stream.write(data);
            }
          });
        });
        socket.on('end', () => {
          log.info('--------end---------');
        });
      });
    });
  });
}

module.exports = {
  initIO,
};
