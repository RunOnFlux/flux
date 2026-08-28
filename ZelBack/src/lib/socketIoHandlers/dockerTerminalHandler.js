const verificationHelperUtils = require('../../services/verificationHelperUtils');
const dockerService = require('../../services/dockerService');
const serviceHelper = require('../../services/serviceHelper');
const { trackTerminalSession } = require('../../services/analyticsService');

const log = require('../log');

async function dockerTerminalHandler(socket) {
  const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;

  // Anything that throws in a socket.io listener is unhandled and takes the whole
  // FluxOS process down, so every failure here has to leave through
  // socket.emit('error', ...) instead.
  //
  // The try/catch below only covers this listener's own body - the dockerode and
  // socket callbacks registered inside it run LATER, after the try has exited, so
  // they are each wrapped in `guard` rather than relying on it.
  socket.on('exec', async (zelidauth, nameOrId, dockerCmd, dockerEnv, dockerUser) => {
    // wrap a callback that runs outside this listener's try/catch
    const guard = (label, fn) => (...args) => {
      try {
        return fn(...args);
      } catch (error) {
        log.error(`dockerTerminalHandler: ${label} for ${nameOrId}: ${error.message}`);
        socket.emit('error', 'Terminal session error.');
        return undefined;
      }
    };
    // Registered BEFORE the awaits below: a disconnect can land while auth and
    // the docker lookups are still in flight (deterministically, for a client
    // that emits 'exec' and closes), and a listener added after socket.io's
    // single 'disconnect' emit never fires - leaking the hijacked stream and
    // its exec for as long as the container lives.
    let execStream = null;
    let clientGone = false;
    let analyticsOpened = false;
    // Derived synchronously from nameOrId so the disconnect listener below can
    // own BOTH halves of the analytics pair. A close listener registered later
    // (after the awaits) can never fire when the client left during them -
    // socket.io emits 'disconnect' exactly once - which is how an 'open' ends up
    // recorded with no matching 'close'.
    const mainAppName = nameOrId.split('_')[1] || nameOrId;
    const parts = nameOrId.split('_');
    const component = parts.length > 1 ? parts[0].replace(/^(zel|flux)/, '') || null : null;
    const analyticsAppName = parts.length > 1 ? mainAppName : mainAppName.replace(/^(zel|flux)/, '');
    socket.on('disconnect', () => {
      clientGone = true;
      if (execStream) execStream.destroy();
      // pairs whatever was opened, regardless of where in the flow we were
      if (analyticsOpened) trackTerminalSession(zelidauth, analyticsAppName, 'close', clientIp, component);
    });
    try {
      const auth = {
        zelidauth,
      };
      // Authorise BEFORE touching Docker: the lookup below is a remote-controlled
      // operation on an attacker-supplied name, and must not be reachable by an
      // unauthenticated caller.
      const authorized = await verificationHelperUtils.verifyAppOwnerOrFluxTeamSession(auth, mainAppName);
      if (authorized !== true) {
        socket.emit('error', 'Not authorized.');
        return;
      }
      // getDockerContainerByIdOrName reads .Id off an undefined lookup result when
      // the container is absent, so this rejects rather than returning null. An
      // unreachable daemon rejects here too and reaches the client as the same
      // "not found" - log the cause so the two are distinguishable.
      const container = await dockerService.getDockerContainerByIdOrName(nameOrId).catch((error) => {
        log.error(`dockerTerminalHandler: container lookup failed for ${nameOrId}: ${error.message}`);
        return null;
      });
      if (!container) {
        socket.emit('error', 'Container not found.');
        return;
      }

      // the client may have gone away during the awaits above - do not create an
      // exec nobody is attached to, and do not record a session that never
      // happened. This check has to precede the analytics open: a client that
      // left during the awaits has already had its 'disconnect' delivered, so
      // nothing downstream can close a session opened after it.
      if (clientGone || !socket.connected) return;

      trackTerminalSession(zelidauth, analyticsAppName, 'open', clientIp, component);
      analyticsOpened = true;

      const cmd = {
        AttachStdout: true,
        AttachStderr: true,
        AttachStdin: true,
        Tty: true,
        Cmd: serviceHelper.commandStringToArray(dockerCmd),
        Env: serviceHelper.commandStringToArray(dockerEnv),
        User: dockerUser,
      };
      container.exec(cmd, guard('exec create', (err, exec) => {
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
        socket.on('resize', guard('resize', (data) => {
          const { rows, cols } = data;
          exec.resize({ h: rows, w: cols }, () => {
          });
        }));
        /* eslint-disable no-shadow */
        exec.start(options, guard('exec start', (err, stream) => {
          // Same defensive check as above: on failure stream can be null, and the
          // stream.on(...) below would throw an unhandled TypeError out of this
          // callback (crashing the process). Bail out cleanly instead.
          if (err || !stream) {
            log.error(`dockerTerminalHandler: exec start failed for ${nameOrId}: ${err ? err.message : 'no stream'}`);
            socket.emit('error', 'Error executing the command.');
            return;
          }
          stream.on('data', guard('stream data', (chunk) => {
            socket.emit('show', chunk.toString());
          }));

          // The hijacked stream is the raw upgraded docker socket, and node
          // detaches its own error handler at upgrade - so without this listener
          // a write racing the exec teardown (EPIPE on a keystroke as the shell
          // exits) is an uncaught exception that exits the whole process.
          stream.on('error', guard('stream error', (error) => {
            log.error(`dockerTerminalHandler: stream error for ${nameOrId}: ${error.message}`);
            socket.emit('error', 'Terminal session error.');
          }));

          // Hand the stream to the disconnect teardown registered before the
          // awaits, and close the race the other way: if the client vanished
          // while exec.start was in flight, its disconnect has already fired
          // and nothing else would ever destroy this stream.
          execStream = stream;
          if (clientGone || !socket.connected) {
            stream.destroy();
            return;
          }

          // A keystroke racing the container's teardown fails ASYNCHRONOUSLY via
          // the stream's 'error' event (handled above) - a destroyed socket's
          // write() just returns false. The type filter is what stops a
          // non-string payload throwing synchronously out of write().
          socket.on('cmd', guard('cmd', (data) => {
            if (typeof data !== 'object') {
              stream.write(data);
            }
          }));
        }));
        socket.on('end', () => {
          log.info('--------end---------');
        });
      }));
    } catch (error) {
      log.error(`dockerTerminalHandler: ${nameOrId}: ${error.message}`);
      socket.emit('error', 'Error opening a terminal.');
    }
  });
}

module.exports = dockerTerminalHandler;
