const verificationHelper = require('../../services/verificationHelper');
const { Privilege } = require('../../services/utils/privileges');
const dockerService = require('../../services/dockerService');
const serviceHelper = require('../../services/serviceHelper');
const { trackTerminalSession } = require('../../services/analyticsService');

const log = require('../log');

async function dockerTerminalHandler(socket) {
  const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;

  // One terminal per connection, owned by the connection rather than by the
  // message that opened it.
  //
  // Everything below used to be declared inside the 'exec' listener, so each
  // message brought its own copy of it and registered its own 'cmd', 'resize'
  // and 'disconnect' listeners on the shared socket. A client emitting 'exec'
  // twice got two shells and one keystroke written to both of them.
  //
  // A connection carries one terminal, so a second 'exec' on it is refused
  // rather than stacked. That is this end's rule and does not rest on the
  // client's behaviour, though the client agrees: it opens a socket per
  // terminal, and socket.io-client forces a new connection for a namespace it
  // already holds, so several terminals on one node are several sockets.
  const session = {
    // Whether a terminal exists on this connection or is being set up right now
    // - not whether one was ever attempted. A setup that fails gives it back, so
    // the refusal below can only ever be told to a caller that really has one.
    claimed: false,
    exec: null,
    stream: null,
    // What a close has to be able to say, recorded at the moment the open was.
    opened: null,
  };
  let clientGone = false;

  // Safe to run twice, which is what closes the setup race: a disconnect that
  // lands while exec.start is in flight runs this with no stream to destroy,
  // and the callback runs it again once there is one. Neither pass can record
  // a second close, because the first clears what a close is made from.
  const closeSession = () => {
    if (session.stream) {
      session.stream.destroy();
      session.stream = null;
    }
    if (session.opened) {
      const { zelidauth, appName, component } = session.opened;
      trackTerminalSession(zelidauth, appName, 'close', clientIp, component);
      session.opened = null;
    }
  };

  // Registered once, at connection, ahead of any message. Two reasons: a
  // disconnect can land while authorisation and the docker lookups are still in
  // flight, and socket.io emits 'disconnect' exactly once - a listener added
  // after it has been delivered never fires, which leaked the hijacked stream
  // and its exec for as long as the container lived. And a listener registered
  // per message is a listener that accumulates.
  socket.on('disconnect', () => {
    clientGone = true;
    closeSession();
  });

  // Both route to whatever session exists, and do nothing before there is one.
  // That is the whole price of registering them ahead of the shell they drive.
  socket.on('resize', (data) => {
    if (!session.exec) return;
    const { rows, cols } = data || {};
    session.exec.resize({ h: rows, w: cols }, () => { });
  });

  // A keystroke racing the container's teardown fails ASYNCHRONOUSLY through the
  // stream's 'error' event - a destroyed socket's write() just returns false.
  // The type filter is what stops a non-string payload throwing out of write().
  socket.on('cmd', (data) => {
    if (!session.stream) return;
    if (typeof data !== 'object') session.stream.write(data);
  });

  // Every way the setup below can fail ends here, so releasing what it took is
  // part of failing rather than something each path has to remember. It pairs
  // the analytics open too: a setup that recorded one and then failed used to
  // leave it hanging until the socket closed.
  const abandonSetup = (message) => {
    closeSession();
    session.exec = null;
    session.claimed = false;
    if (message) socket.emit('error', message);
  };

  socket.on('exec', async (zelidauth, nameOrId, dockerCmd, dockerEnv, dockerUser) => {
    // Ahead of everything, because this namespace takes no middleware: the five
    // arguments are whatever an unauthenticated client serialised, and nothing
    // upstream makes them strings the way node's http parser does for a header.
    //
    // nameOrId is split to name the app below, and a throw in an async socket.io
    // listener is a rejection nobody handles - it reached apiServer's
    // uncaughtException handler and exited the node.
    //
    // zelidauth is refused here rather than at verifyPrivilege, which throws a
    // TypeError for a non-string on purpose: that TypeError says our own code
    // wired the call wrongly, and it cannot go on meaning that while any
    // stranger can raise it on demand.
    if (typeof nameOrId !== 'string') {
      socket.emit('error', 'No container specified.');
      return;
    }
    if (typeof zelidauth !== 'string') {
      socket.emit('error', 'Not authorized.');
      return;
    }
    if (session.claimed) {
      socket.emit('error', 'This connection already has a terminal.');
      return;
    }
    session.claimed = true;

    // Wraps a callback that runs outside this listener's try/catch. The dockerode
    // and stream callbacks below are called by libraries, not by socket.io, so
    // the guard that catches a failing socket listener does not reach them.
    const guard = (label, fn) => (...args) => {
      try {
        return fn(...args);
      } catch (error) {
        log.error(`dockerTerminalHandler: ${label} for ${nameOrId}: ${error.message}`);
        socket.emit('error', 'Terminal session error.');
        return undefined;
      }
    };

    const mainAppName = nameOrId.split('_')[1] || nameOrId;
    const parts = nameOrId.split('_');
    const component = parts.length > 1 ? parts[0].replace(/^(zel|flux)/, '') || null : null;
    const analyticsAppName = parts.length > 1 ? mainAppName : mainAppName.replace(/^(zel|flux)/, '');

    try {
      // Authorise BEFORE touching Docker: the lookup below is a remote-controlled
      // operation on an attacker-supplied name, and must not be reachable by an
      // unauthenticated caller.
      //
      // Through verifyPrivilege like every other caller, so this shell carries a
      // privilege a sweep can find. Reaching the verifier directly is what once
      // hid an interactive root shell from a search for the privilege it needed.
      const authorized = await verificationHelper.verifyPrivilege(
        Privilege.APP_OWNER_OR_FLUX_TEAM,
        zelidauth,
        { appName: mainAppName },
      );
      if (authorized !== true) {
        abandonSetup('Not authorized.');
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
        abandonSetup('Container not found.');
        return;
      }

      // The client may have gone away during the awaits above - do not create an
      // exec nobody is attached to, and do not record a session that never
      // happened. This check has to precede the open: a client that left during
      // the awaits has already had its 'disconnect' delivered, and the close it
      // ran found nothing to pair.
      if (clientGone || !socket.connected) {
        abandonSetup();
        return;
      }

      trackTerminalSession(zelidauth, analyticsAppName, 'open', clientIp, component);
      session.opened = { zelidauth, appName: analyticsAppName, component };

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
        // exited). Without this the code below dereferences null and the
        // TypeError leaves a library callback, where nothing catches it.
        if (err || !exec) {
          log.error(`dockerTerminalHandler: exec create failed for ${nameOrId}: ${err ? err.message : 'no exec instance (is the container running?)'}`);
          abandonSetup('Error opening a terminal. Is the container running?');
          return;
        }
        session.exec = exec;

        const options = {
          Tty: true,
          stream: true,
          stdin: true,
          stdout: true,
          stderr: true,
          hijack: true,
        };
        /* eslint-disable no-shadow */
        exec.start(options, guard('exec start', (err, stream) => {
          // Same check as above: on failure stream can be null, and the
          // stream.on(...) below would throw out of a library callback.
          if (err || !stream) {
            log.error(`dockerTerminalHandler: exec start failed for ${nameOrId}: ${err ? err.message : 'no stream'}`);
            abandonSetup('Error executing the command.');
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

          // Hand the stream to the session, and close the race the other way: if
          // the client vanished while exec.start was in flight its disconnect has
          // already run, and nothing else would ever destroy this stream.
          session.stream = stream;
          if (clientGone || !socket.connected) closeSession();
        }));
      }));
    } catch (error) {
      log.error(`dockerTerminalHandler: ${nameOrId}: ${error.message}`);
      abandonSetup('Error opening a terminal.');
    }
  });
}

module.exports = dockerTerminalHandler;
