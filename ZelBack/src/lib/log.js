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

function error(...args) {
  try {
    // write to file
    const datadir = `${homeDirPath}zelflux`;
    const filepath = `${datadir}/error.log`;
    const size = getFilesizeInBytes(filepath);
    let flag = 'a+';
    if (size > (25 * 1000 * 1000)) { // 25MB
      flag = 'w';                    // rewrite file
    }

    const data_zone = new Date(new Date().getTime() -
                               (new Date().getTimezoneOffset() * 60000))
                          .toISOString()
                          .replace(/T/, ' ')
                          .replace(/\..+/, '');

    const stream = fs.createWriteStream(filepath, {flags : flag});
    Object.getPrototypeOf(args.toString()) === Object.prototype;
    var type = Function.prototype.call.bind(Object.prototype.toString);

    if (type(args) == '[object Array]' &&
        args.toString() == "[object Object]") {

      var error = JSON.parse(JSON.stringify(...args));
      error = error.message;
      stream.write(data_zone + " => ERROR: " + error + "\n");

    } else {
      var error = args;
      stream.write(data_zone + " => ERROR: " + error + "\n");
    }

    stream.end();
  } catch (err) {
    console.error('This shall not have happened');
    console.error(err);
  }
}

module.exports = {
  error,

  warn(...args) { console.warn(...args); },

  info(...args) { console.log(...args); },

  debug(...args) { console.log(...args); },
};
