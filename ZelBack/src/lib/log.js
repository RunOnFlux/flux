// const fs = require('fs');
// const path = require('path');
// const config = require('config');

// const levels = {
//   off: -1,
//   error: 0,
//   warn: 1,
//   info: 2,
//   debug: 3,
// };

// const logLevel = config && config.logLevel ? config.logLevel : levels.debug;

// const homeDirPath = path.join(__dirname, '../../../');

// const fileSizeCache = {};

// function getFilesizeInBytes(filename) {
//   if (filename && fileSizeCache[filename]) {
//     return fileSizeCache[filename];
//   }

//   try {
//     const stats = fs.statSync(filename);
//     const fileSizeInBytes = stats.size;

//     fileSizeCache[filename] = fileSizeInBytes;

//     return fileSizeInBytes;
//   } catch (e) {
//     console.log(e);
//     return 0;
//   }
// }

// function ensureString(parameter) {
//   return typeof parameter === 'string' ? parameter : JSON.stringify(parameter);
// }

// function writeToFile(filepath, args) {
//   const size = getFilesizeInBytes(filepath);
//   let flag = 'a+';
//   if (size > 25 * 1024 * 1024) {
//     // 25MB
//     flag = 'w'; // rewrite file
//     fileSizeCache[filepath] = 0;
//   }
//   const stream = fs.createWriteStream(filepath, { flags: flag });

//   const content = ensureString(args.message || args);

//   fileSizeCache[filepath] += Buffer.byteLength(content);

//   stream.write(`${new Date().toISOString()}          ${content}\n`);

//   if (args.stack && typeof args.stack === 'string') {
//     fileSizeCache[filepath] += Buffer.byteLength(args.stack);
//     stream.write(`${args.stack}\n`);
//   }

//   stream.end();
// }

// function debug(args) {
//   if (logLevel < levels.debug) {
//     return;
//   }
//   try {
//     console.log(args);
//     // write to file
//     const filepath = `${homeDirPath}debug.log`;
//     writeToFile(filepath, args);
//   } catch (err) {
//     console.error('This should not have happened');
//     console.error(err);
//   }
// }

// function error(args) {
//   if (logLevel < levels.error) {
//     return;
//   }
//   try {
//     // write to file
//     const filepath = `${homeDirPath}error.log`;
//     writeToFile(filepath, args);
//     debug(args);
//   } catch (err) {
//     console.error('This should not have happened');
//     console.error(err);
//   }
// }

// function warn(args) {
//   if (logLevel < levels.warn) {
//     return;
//   }
//   try {
//     // write to file
//     const filepath = `${homeDirPath}warn.log`;
//     writeToFile(filepath, args);
//     debug(args);
//   } catch (err) {
//     console.error('This should not have happened');
//     console.error(err);
//   }
// }

// function info(args) {
//   if (logLevel < levels.info) {
//     return;
//   }
//   try {
//     // write to file
//     const filepath = `${homeDirPath}info.log`;
//     writeToFile(filepath, args);
//     debug(args);
//   } catch (err) {
//     console.error('This should not have happened');
//     console.error(err);
//   }
// }

// module.exports = {
//   error,
//   warn,
//   info,
//   debug,
// };

module.exports = console
