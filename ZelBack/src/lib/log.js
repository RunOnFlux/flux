const util = require('node:util');
const path = require('node:path');

const pino = require('pino');

const homeDir = path.join(__dirname, '../../../');
const levels = ["debug", "info", "warn", "error"];

// const hooks = {
//   logMethod(inputArgs, method, level) {
//     if (inputArgs.length >= 2) {
//       const arg1 = inputArgs.shift()
//       const arg2 = inputArgs.shift()
//       return method.apply(this, [arg2, arg1, ...inputArgs])
//     }
//     return method.apply(this, inputArgs)
//   }
// }

const targets = levels.map((level) => {
  const destination = path.join(homeDir, `${level}.log`);
  return { target: 'pino/file', level, options: { destination, colorize: false } }
})

fileLogs = pino({ level: 'debug', transport: { targets } });

// https://en.m.wikipedia.org/wiki/ANSI_escape_code#Colors
const colors = {
  debug: "\x1b[36m", // cyan
  info: '\x1b[32m', // green
  warn: "\x1b[33m", // yellow
  error: "\x1b[91m", // bright red
  reset: "\x1b[0m"
};

const logger = (logType) => {
  return (...args) => {
    if (process.stdout.isTTY) {
      const time = new Date().toISOString();
      const output = util.formatWithOptions(
        { colors: true },
        time,
        `${colors[logType]}${logType}${colors['reset']}:`,
        ...args
      );
      process.stdout.write(output.replace(/\n/g, '\r\n') + '\r\n');
    }
    fileLogs[logType](...args);
  }
}

module.exports = {
  debug: logger('debug'),
  info: logger('info'),
  warn: logger('warn'),
  error: logger('error'),
};
