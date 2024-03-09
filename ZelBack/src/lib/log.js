// const pino = require('pino');

// const logController = require('./logController')
// const path = require('path')

// const log = logController.getLogger();
// const homeDir = path.join(__dirname, '../../../');
// const levels = ["debug", "info", "error"];

// levels.forEach((level) => {
//   const filePath = path.join(homeDir, `${level}.log`);
//   logController.addLoggerTransport("file", { level, filePath });
// });

// const transports = pino.transport({
//     targets: [{
//         level: 'info',
//         target: 'pino/file'
//     }, {
//         level: 'trace',
//         target: 'pino/file',
//         options: { destination: '/path/to/store/logs' }
//     }]
// })


// const transport = pino.transport({
//   level: 'debug',
//   target: 'pino-pretty',
//   options: {
//     crlf: true
//     // destination: 1
//     // translateTime: 'yyyy-mm-dd HH:MM:ss:L',
//   }
// })

// const log = pino(transport);

// module.exports = log

// https://en.m.wikipedia.org/wiki/ANSI_escape_code#Colors
const colors = {
  error: "\x1b[91m", // bright red
  warn: "\x1b[33m", // yellow
  info: '\x1b[32m', // green
  debug: "\x1b36m", // cyan
  reset: "\x1b[0m"
};

const logger = (logType) => {
  return (...args) => {
    const time = new Date().toISOString()
    console.log(time, `${colors[logType]}${logType}${colors['reset']}:`, ...args)
  }
}

module.exports = {
  info: logger('info'),
  debug: logger('debug'),
  error: logger('error'),
  warn: logger('warn'),
};
