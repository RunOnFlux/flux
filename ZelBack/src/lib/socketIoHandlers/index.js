const debugHandler = require('./debugHandler');
const dockerTerminalHandler = require('./dockerTerminalHandler');
const appLogsHandler = require('./appLogsHandler');

module.exports = {
  debug: debugHandler,
  terminal: dockerTerminalHandler,
  applogs: appLogsHandler,
};
