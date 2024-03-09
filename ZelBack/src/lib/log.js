// const pino = require('pino');

const logController = require('./logController')
const path = require('path')

const log = logController.getLogger();
const homeDir = path.join(__dirname, '../../../');
const levels = ["debug", "info", "error"];

levels.forEach((level) => {
  const filePath = path.join(homeDir, `${level}.log`);
  logController.addLoggerTransport("file", { level, filePath });
});

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


const transport = pino.transport({
  level: 'debug',
  target: 'pino-pretty',
  options: {
    crlf: true
    // destination: 1
    // translateTime: 'yyyy-mm-dd HH:MM:ss:L',
  }
})

// const log = pino(transport);

module.exports = log

// const logger = (...args) => {
//   const time = new Date().toISOString()
//   console.log(time, ...args)
// }

// module.exports = { info: logger, debug: logger, error: logger, warn: logger }
