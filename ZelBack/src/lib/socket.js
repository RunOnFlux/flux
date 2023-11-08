const socketio = require('socket.io');
const Docker = require('dockerode');
const splitargs = require('splitargs');
const log = require('./log');

const docker = new Docker();
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
    socket.on('exec', (id, w, h, dockerCmd, dockerEnv) => {
      const container = docker.getContainer(id);
      const cmd = {
        AttachStdout: true,
        AttachStderr: true,
        AttachStdin: true,
        Tty: true,
        Cmd: splitargs(dockerCmd),
        Env: splitargs(dockerEnv),
      };
      socket.on('resize', (data) => {
        const { rows, cols } = data;
        container.resize({ h: rows, w: cols }, () => {
        });
      });
      container.exec(cmd, (err, exec) => {
        const options = {
          Tty: true,
          stream: true,
          stdin: true,
          stdout: true,
          stderr: true,
          hijack: true,
        };

        /* eslint-disable no-shadow, no-unused-vars */
        container.wait((err, data) => {
          socket.emit('end', 'ended');
        });

        if (err) {
          return;
        }
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
