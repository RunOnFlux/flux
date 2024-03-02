const logController = require('./logController')
const path = require('path')

const log = logController.getLogger();
const homeDir = path.join(__dirname, '../../../');
const levels = ["debug", "info", "error"];

levels.forEach((level) => {
  const filePath = path.join(homeDir, `${level}.log`);
  logController.addLoggerTransport("file", { level, filePath });
});

module.exports = log
