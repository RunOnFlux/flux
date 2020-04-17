const fs = require('fs');

function getFilesizeInBytes(filename) {
  const stats = fs.statSync(filename);
  const fileSizeInBytes = stats.size;
  return fileSizeInBytes;
}

function error(...args) {
  console.error(...args);
  // write to file
  const filepath = '~/zelflux/error.log';
  const size = getFilesizeInBytes(filepath);
  let flag = 'a+';
  if (size > (25 * 1000 * 1000)) { // 25MB
    flag = 'w'; // rewrite file
  }
  const stream = fs.createWriteStream(filepath, { flags: flag });
  stream.write(`${new Date().toISOString()}          ${[...args]}\n`);
  stream.end();
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
