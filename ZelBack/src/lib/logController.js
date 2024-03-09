const winston = require("winston");

const { combine, timestamp, label, printf } = winston.format;

const formatter = printf(({ level, message, label, timestamp, stack }) => {
  return `${timestamp} [${label}] ${level}: ${message}`;
});

// const errorStackFormat = winston.format(info => {
//   if (info instanceof Error) {
//     return Object.assign({}, info, {
//       stack: info.stack,
//       message: info.message
//     })
//   }
//   return info
// })


const simpleConsole = printf(({ level, message, timestamp, stack }) => {
  if (stack) {
    return `${timestamp} ${level}: ${message} - ${stack}`;
  }
  return `${timestamp} ${level}: ${message}`;
});

const colorsLogger = {
  error: "red",
  warn: "yellow"
  // info: 'cyan',
  // debug: "green"
};

winston.addColors(colorsLogger);

class FluxLogger {
  logger;
  defaultConsole;

  constructor() {
    this.logger = winston.createLogger({
      silent: true,
      format: combine(
        // errorStackFormat(),
        winston.format.errors({ stack: true }),
        winston.format.splat(),

      )
    });
    this.loggingConsole = true;
    this.defaultConsole = new winston.transports.Console({
      level: "debug",
      format: combine(
        winston.format.colorize(),
        // winston.format.simple()
        simpleConsole
      )
    });

    this.logger.add(this.defaultConsole);
  }

  getLogger() {
    return this.logger;
  }

  addLoggerTransport(type, options = {}) {
    const level = options.logLevel || "info";

    this.logger.silent = false;

    if (type === "file") {
      // add error handling
      this.logger.add(
        new winston.transports.File({
          level: level,
          filename: options.filePath,
          format: combine(
            label({ label: "fluxOS" }),
            timestamp(),
            formatter
          )
        })
      );

      if (!process.stdout.isTTY && this.loggingConsole) {
        this.loggingConsole = false;
        this.logger.remove(this.defaultConsole);
      }
    } else if (type === "console") {
      this.defaultConsole.level = level || this.defaultConsole.level;
    }
  }
}

module.exports = new FluxLogger();
