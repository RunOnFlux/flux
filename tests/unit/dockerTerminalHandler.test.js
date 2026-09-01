const chai = require('chai');
const sinon = require('sinon');

const { Privilege } = require('../../ZelBack/src/services/utils/privileges');
const proxyquire = require('proxyquire');

const { expect } = chai;

describe('dockerTerminalHandler tests', () => {
  let trackTerminalSession;
  let verifyPrivilege;
  let getDockerContainerByIdOrName;
  let dockerTerminalHandler;

  // Minimal stand-in for a socket.io socket. `fire` returns the listener's own
  // promise so a test can hold the handler mid-flight and interleave a
  // disconnect, which is the race being covered here.
  const makeSocket = () => {
    const listeners = {};
    return {
      handshake: { headers: {}, address: '10.0.0.7' },
      connected: true,
      emit: sinon.stub(),
      on(event, fn) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      fire(event, ...args) {
        return Promise.all((listeners[event] || []).map((fn) => fn(...args)));
      },
      listenerCount(event) {
        return (listeners[event] || []).length;
      },
    };
  };

  const sessionsOfType = (type) => trackTerminalSession.getCalls().filter((call) => call.args[2] === type);

  beforeEach(() => {
    trackTerminalSession = sinon.stub();
    verifyPrivilege = sinon.stub().resolves(true);
    getDockerContainerByIdOrName = sinon.stub().resolves({ exec: sinon.stub() });
    dockerTerminalHandler = proxyquire('../../ZelBack/src/lib/socketIoHandlers/dockerTerminalHandler', {
      '../../services/analyticsService': { trackTerminalSession },
      '../../services/verificationHelper': { verifyPrivilege },
      '../../services/dockerService': { getDockerContainerByIdOrName },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('does not record a session that never opened when the client leaves mid-setup', async () => {
    const socket = makeSocket();
    let releaseAuth;
    verifyPrivilege.returns(new Promise((resolve) => { releaseAuth = resolve; }));

    dockerTerminalHandler(socket);
    const exec = socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');

    // The client closes the tab while authorisation is still in flight. socket.io
    // emits 'disconnect' exactly once, so by the time the awaits below finish
    // there is nothing left that could ever close a session opened after this.
    socket.connected = false;
    await socket.fire('disconnect');

    releaseAuth(true);
    await exec;

    // An 'open' here would be permanent: no matching 'close' can follow it, and
    // the analytics side reads that as a terminal session still in progress.
    expect(sessionsOfType('open')).to.have.lengthOf(0);
    expect(sessionsOfType('close')).to.have.lengthOf(0);
  });

  it('pairs open with close for a session that did open', async () => {
    const stream = { on: sinon.stub(), destroy: sinon.stub(), write: sinon.stub() };
    const execInstance = { start: (options, cb) => cb(null, stream), resize: sinon.stub() };
    getDockerContainerByIdOrName.resolves({ exec: (cmd, cb) => cb(null, execInstance) });

    const socket = makeSocket();
    dockerTerminalHandler(socket);
    await socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');

    expect(sessionsOfType('open')).to.have.lengthOf(1);
    expect(sessionsOfType('open')[0].args[1]).to.equal('myapp');
    expect(sessionsOfType('open')[0].args[4]).to.equal('comp');
    expect(sessionsOfType('close')).to.have.lengthOf(0);

    socket.connected = false;
    await socket.fire('disconnect');

    expect(sessionsOfType('close')).to.have.lengthOf(1);
    expect(sessionsOfType('close')[0].args[1]).to.equal('myapp');
    expect(stream.destroy.calledOnce).to.be.true;
  });

  // The terminal is the one app-scoped entry point that does not go through
  // verifyPrivilege, so it carries no privilege string and a sweep for one does
  // not reach it. This is the only assertion that says a shell inside a
  // customer's container is not the node operator's, and it names the check by
  // function rather than by argument for the same reason.
  it('authorises a session with the check that refuses the node operator', async () => {
    const socket = makeSocket();
    dockerTerminalHandler(socket);
    await socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');

    // Through verifyPrivilege, carrying the privilege it needs, so a search for
    // who may open a shell in a customer's container finds this one too.
    sinon.assert.calledOnceWithExactly(
      verifyPrivilege,
      Privilege.APP_OWNER_OR_FLUX_TEAM,
      'zelidauth',
      { appName: 'myapp' },
    );
  });

  // Every argument arrives as whatever the client serialised: this is a socket
  // event, and nothing upstream turns it into a string the way node's http
  // parser does for a header. The namespace takes no middleware, so an
  // unauthenticated caller chooses all five.
  //
  // nameOrId is split to name the app BEFORE the try begins, so a caller that
  // omitted it threw where nothing catches - and a rejection in an async
  // socket.io listener is one nobody handles: node raises it to apiServer's
  // uncaughtException handler, which exits the process. Emitting exec with no
  // arguments was an unauthenticated restart of the node.
  // The session belongs to the connection, not to the message that opened it.
  // Everything below used to live inside the 'exec' listener, so a second 'exec'
  // brought a second shell and a second set of listeners on the one socket - and
  // a keystroke was then written into both shells.
  describe('the session the connection owns', () => {
    const workingShell = () => {
      const stream = { on: sinon.stub(), destroy: sinon.stub(), write: sinon.stub() };
      const execInstance = { start: (options, cb) => cb(null, stream), resize: sinon.stub() };
      getDockerContainerByIdOrName.resolves({ exec: (cmd, cb) => cb(null, execInstance) });
      return { stream, execInstance };
    };

    it('registers its listeners for the connection, before any message', async () => {
      const socket = makeSocket();

      await dockerTerminalHandler(socket);

      ['exec', 'cmd', 'resize', 'disconnect'].forEach((event) => {
        expect(socket.listenerCount(event), `${event} is not registered at connection`).to.equal(1);
      });
    });

    it('leaves those listeners alone however many times exec is sent', async () => {
      workingShell();
      const socket = makeSocket();
      dockerTerminalHandler(socket);

      await socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');
      await socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');

      ['cmd', 'resize', 'disconnect'].forEach((event) => {
        expect(socket.listenerCount(event), `${event} accumulated on the socket`).to.equal(1);
      });
    });

    it('refuses a second terminal rather than opening one beside the first', async () => {
      workingShell();
      const socket = makeSocket();
      dockerTerminalHandler(socket);
      await socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');
      socket.emit.resetHistory();

      await socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');

      sinon.assert.calledOnceWithExactly(socket.emit, 'error', 'This connection already has a terminal.');
      expect(verifyPrivilege.callCount, 'the refused message still reached docker').to.equal(1);
      expect(sessionsOfType('open')).to.have.lengthOf(1);
    });

    // The claim says a terminal exists or is being set up, not that one was ever
    // attempted. A setup that failed left neither, and telling the next attempt
    // it already has a terminal would simply be untrue.
    it('lets the caller try again when the setup failed', async () => {
      getDockerContainerByIdOrName.resolves(null);
      const socket = makeSocket();
      dockerTerminalHandler(socket);
      await socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');
      sinon.assert.calledOnceWithExactly(socket.emit, 'error', 'Container not found.');

      workingShell();
      socket.emit.resetHistory();
      await socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');

      sinon.assert.notCalled(socket.emit);
      expect(verifyPrivilege.callCount, 'the retry was refused a terminal it did not have').to.equal(2);
      expect(sessionsOfType('open')).to.have.lengthOf(1);
    });

    // The open is recorded before the exec is created, so a setup that fails
    // after it has to pair it. It used to hang unpaired until the socket closed.
    it('pairs the session it recorded when the shell then fails to start', async () => {
      getDockerContainerByIdOrName.resolves({ exec: (cmd, cb) => cb(new Error('container is not running'), null) });
      const socket = makeSocket();
      dockerTerminalHandler(socket);

      await socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');

      sinon.assert.calledOnceWithExactly(socket.emit, 'error', 'Error opening a terminal. Is the container running?');
      expect(sessionsOfType('open')).to.have.lengthOf(1);
      expect(sessionsOfType('close'), 'the open it recorded was left hanging').to.have.lengthOf(1);
    });

    it('ignores a keystroke and a resize sent before the shell exists', async () => {
      const socket = makeSocket();
      dockerTerminalHandler(socket);

      await socket.fire('cmd', 'ls\n');
      await socket.fire('resize', { rows: 10, cols: 20 });

      sinon.assert.notCalled(socket.emit);
    });

    // The control for the two above: a handler that routed nothing anywhere
    // would pass both of them.
    it('routes a keystroke and a resize to the shell once it exists', async () => {
      const { stream, execInstance } = workingShell();
      const socket = makeSocket();
      dockerTerminalHandler(socket);
      await socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');

      await socket.fire('cmd', 'ls\n');
      await socket.fire('resize', { rows: 10, cols: 20 });

      sinon.assert.calledOnceWithExactly(stream.write, 'ls\n');
      sinon.assert.calledOnce(execInstance.resize);
      expect(execInstance.resize.firstCall.args[0]).to.deep.equal({ h: 10, w: 20 });
    });
  });

  // Both halves of the setup race, which is what the listeners being registered
  // at connection buys. socket.io emits 'disconnect' exactly once, so a client
  // that leaves mid-setup has already had it delivered: nothing registered
  // afterwards can ever run, and whatever the setup goes on to create is left
  // with nobody to destroy it.
  describe('a client that leaves while the shell is being set up', () => {
    it('records no session when it leaves before the shell was opened', async () => {
      const socket = makeSocket();
      let releaseAuth;
      verifyPrivilege.returns(new Promise((resolve) => { releaseAuth = resolve; }));

      dockerTerminalHandler(socket);
      const exec = socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');
      socket.connected = false;
      await socket.fire('disconnect');
      releaseAuth(true);
      await exec;

      expect(sessionsOfType('open')).to.have.lengthOf(0);
      expect(sessionsOfType('close')).to.have.lengthOf(0);
    });

    it('destroys the stream and pairs the session when it leaves after the shell was opened', async () => {
      const stream = { on: sinon.stub(), destroy: sinon.stub(), write: sinon.stub() };
      let releaseStart;
      const execInstance = {
        start: (options, cb) => { releaseStart = () => cb(null, stream); },
        resize: sinon.stub(),
      };
      getDockerContainerByIdOrName.resolves({ exec: (cmd, cb) => cb(null, execInstance) });

      const socket = makeSocket();
      dockerTerminalHandler(socket);
      // Runs as far as exec.start and stops there, which is where the stream
      // this test is about does not exist yet.
      await socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');

      socket.connected = false;
      await socket.fire('disconnect');
      releaseStart();

      expect(stream.destroy.calledOnce, 'a stream nobody is attached to was left open').to.equal(true);
      expect(sessionsOfType('open')).to.have.lengthOf(1);
      expect(sessionsOfType('close'), 'the open it recorded was never paired').to.have.lengthOf(1);
    });
  });

  describe('arguments the client chose', () => {
    const malformed = [
      { what: 'no container at all', args: ['zelidauth'], answer: 'No container specified.' },
      { what: 'a container that is a number', args: ['zelidauth', 12345], answer: 'No container specified.' },
      { what: 'a container that is an object', args: ['zelidauth', { name: 'x' }], answer: 'No container specified.' },
      { what: 'an auth that is an object', args: [{ zelidauth: 'x' }, 'fluxcomp_myapp'], answer: 'Not authorized.' },
    ];

    malformed.forEach(({ what, args, answer }) => {
      it(`answers ${what} instead of taking the node down`, async () => {
        const socket = makeSocket();
        dockerTerminalHandler(socket);

        await socket.fire('exec', ...args);

        sinon.assert.calledOnceWithExactly(socket.emit, 'error', answer);
        expect(verifyPrivilege.called, 'a malformed call reached the privilege check').to.equal(false);
      });
    });

    // The control: the same path with every argument the shape it should be
    // still opens a session, so the refusals above are not a handler that has
    // stopped working.
    it('opens a session when they are the shape they should be', async () => {
      const socket = makeSocket();
      dockerTerminalHandler(socket);

      await socket.fire('exec', 'zelidauth', 'fluxcomp_myapp', 'sh', '', 'root');

      expect(verifyPrivilege.calledOnce).to.equal(true);
    });
  });
});
