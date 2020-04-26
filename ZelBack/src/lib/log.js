const fs = require('fs');
const path = require('path');

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

function ensureString(parameter) {
  return typeof parameter === 'string' ? parameter : JSON.stringify(parameter);
}

function error(...args) {
  try {
    console.error(...args);
    // write to file
    const datadir = `${homeDirPath}zelflux`;
    const filepath = `${datadir}/error.log`;
    const size = getFilesizeInBytes(filepath);
    let flag = 'a+';
    if (size > 25 * 1000 * 1000) {
      // 25MB
      flag = 'w'; // rewrite file
    }
    const stream = fs.createWriteStream(filepath, { flags: flag });
    stream.write(
      `${new Date().toISOString()}          ${ensureString(
        ...(args.message || [...args])
      )}\n`
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
