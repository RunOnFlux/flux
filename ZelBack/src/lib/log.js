// const logController = require('./logController')
// const path = require('path')

// const log = logController.getLogger();
// const homeDir = path.join(__dirname, '../../../');
// const levels = ["debug", "info", "error"];

// levels.forEach((level) => {
//   const filePath = path.join(homeDir, `${level}.log`);
//   logController.addLoggerTransport("file", { level, filePath });
// });

const pino = require('pino');

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

process.stdout.on('data', (data) => console.log('got data'))
console.log(console)
console.log(process.stdout)
console.log(process.stdin)
process.exit(0)



console.log("CREATING TRANSPORT")
const transport = pino.transport({
  level: 'debug',
  target: 'pino-pretty',
  options: {
    destination: 1
    // translateTime: 'yyyy-mm-dd HH:MM:ss:L',
  }
})

// const log = pino(transport);
// module.exports = log


module.exports = { info: console.log, debug: console.log, error: console.log, warn: console.log }
