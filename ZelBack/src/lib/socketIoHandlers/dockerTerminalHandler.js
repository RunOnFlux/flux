const verificationHelperUtils = require('../../services/verificationHelperUtils');
const dockerService = require('../../services/dockerService');
const serviceHelper = require('../../services/serviceHelper');
const { trackTerminalSession } = require('../../services/analyticsService');

const log = require('../log');

async function dockerTerminalHandler(socket) {
  const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;

  // This listener is async, so anything that throws inside it is an unhandled
  // rejection and takes the whole FluxOS process down. Every failure has to leave
  // through socket.emit('error', ...) instead - hence the blanket catch.
  socket.on('exec', async (zelidauth, nameOrId, dockerCmd, dockerEnv, dockerUser) => {
    try {
      const auth = {
        zelidauth,
      };
      const mainAppName = nameOrId.split('_')[1] || nameOrId;
      // Authorise BEFORE touching Docker: the lookup below is a remote-controlled
      // operation on an attacker-supplied name, and must not be reachable by an
      // unauthenticated caller.
      const authorized = await verificationHelperUtils.verifyAppOwnerOrHigherSession(auth, mainAppName);
      if (authorized !== true) {
        socket.emit('error', 'Not authorized.');
        return;
      }
      // getDockerContainerByIdOrName reads .Id off an undefined lookup result when
      // the container is absent, so this rejects rather than returning null.
      const container = await dockerService.getDockerContainerByIdOrName(nameOrId).catch(() => null);
      if (!container) {
        socket.emit('error', 'Container not found.');
        return;
      }

      const parts = nameOrId.split('_');
      const component = parts.length > 1 ? parts[0].replace(/^(zel|flux)/, '') || null : null;
      const analyticsAppName = parts.length > 1 ? mainAppName : mainAppName.replace(/^(zel|flux)/, '');
      trackTerminalSession(zelidauth, analyticsAppName, 'open', clientIp, component);
      socket.on('disconnect', () => {
        trackTerminalSession(zelidauth, analyticsAppName, 'close', clientIp, component);
      });

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
        // dockerode passes back a null exec when the daemon rejects the exec
        // create (most commonly the container is not running - state created or
        // exited). Without this guard the code below dereferences null
        // (exec.start / exec.resize) and the resulting TypeError is thrown from
        // inside this callback, which is unhandled and crashes the whole FluxOS
        // process. Fail the terminal session cleanly instead.
        if (err || !exec) {
          log.error(`dockerTerminalHandler: exec create failed for ${nameOrId}: ${err ? err.message : 'no exec instance (is the container running?)'}`);
          socket.emit('error', 'Error opening a terminal. Is the container running?');
          return;
        }
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
          // Same defensive check as above: on failure stream can be null, and the
          // stream.on(...) below would throw an unhandled TypeError out of this
          // callback (crashing the process). Bail out cleanly instead.
          if (err || !stream) {
            log.error(`dockerTerminalHandler: exec start failed for ${nameOrId}: ${err ? err.message : 'no stream'}`);
            socket.emit('error', 'Error executing the command.');
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
    } catch (error) {
      log.error(`dockerTerminalHandler: ${nameOrId}: ${error.message}`);
      socket.emit('error', 'Error opening a terminal.');
    }
  });
}

module.exports = dockerTerminalHandler;
