const debugHandler = require('./debugHandler');
const dockerTerminalHandler = require('./dockerTerminalHandler');

module.exports = {
  debug: debugHandler,
  terminal: dockerTerminalHandler,
};
