const fs = require('fs');
const path = require('path');
const moment = require('moment');

const homeDirPath = path.join(__dirname, '../../../../');

function getFilesizeInBytes(filename) {
  try {
    const stats = fs.statSync(filename);
    const fileSizeInBytes = stats.size;
    return fileSizeInBytes;
  } catch {
    return 0;
  }
}

function error(...args) {
  try {
    console.error(...args);
    let error;
    const datadir = `${homeDirPath}zelflux`;
    const filepath = `${datadir}/error.log`;
    const size = getFilesizeInBytes(filepath);
    let flag = 'a+';
    if (size > 25 * 1000 * 1000) {
      // 25MB
      flag = 'w'; // rewrite file
    }

    const date = moment.utc().format('YYYY-MM-DD HH:mm:ss');
    const stillUtc = moment.utc(date).toDate();
    const local = moment(stillUtc).local().format('YYYY-MM-DD HH:mm:ss');

    if (`${[...args]}` == '[object Object]') {
      error = JSON.parse(JSON.stringify(...args));
      error = error.message;
    } else {
      error = args;
    }

    const stream = fs.createWriteStream(filepath, { flags: flag });
    stream.write(
      `${new Date().toISOString()} => ${error} / Local Time: ${local}\n`
    );
    stream.end();
  } catch (err) {
    console.error('This shall not have happened');
    console.error(err);
  }
}

module.exports = {
  error,

  warn(...args) {
    console.warn(...args);
  },

  info(...args) {
    console.log(...args);
  },

  debug(...args) {
    console.log(...args);
  },
};
