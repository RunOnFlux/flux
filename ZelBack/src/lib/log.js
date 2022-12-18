import { statSync, createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const homeDirPath = join(__dirname, '../../../');

function getFilesizeInBytes(filename) {
  try {
    const stats = statSync(filename);
    const fileSizeInBytes = stats.size;
    return fileSizeInBytes;
  } catch (e) {
    console.log(e);
    return 0;
  }
}

function ensureString(parameter) {
  return typeof parameter === 'string' ? parameter : JSON.stringify(parameter);
}

function writeToFile(filepath, args) {
  const size = getFilesizeInBytes(filepath);
  let flag = 'a+';
  if (size > (25 * 1024 * 1024)) { // 25MB
    flag = 'w'; // rewrite file
  }
  const stream = createWriteStream(filepath, { flags: flag });
  stream.write(`${new Date().toISOString()}          ${ensureString(args.message || args)}\n`);
  if (args.stack && typeof args.stack === 'string') {
    stream.write(`${args.stack}\n`);
  }
  stream.end();
}

function debug(args) {
  try {
    console.log(args);
    // write to file
    const filepath = `${homeDirPath}debug.log`;
    writeToFile(filepath, args);
  } catch (err) {
    console.error('This should not have happened');
    console.error(err);
  }
}

function error(args) {
  try {
    // console.error(args);
    // write to file
    const filepath = `${homeDirPath}error.log`;
    writeToFile(filepath, args);
    debug(args);
  } catch (err) {
    console.error('This should not have happened');
    console.error(err);
  }
}

function warn(args) {
  try {
    // console.warn(args);
    // write to file
    const filepath = `${homeDirPath}warn.log`;
    writeToFile(filepath, args);
    debug(args);
  } catch (err) {
    console.error('This should not have happened');
    console.error(err);
  }
}

function info(args) {
  try {
    // console.log(args);
    // write to file
    const filepath = `${homeDirPath}info.log`;
    writeToFile(filepath, args);
    debug(args);
  } catch (err) {
    console.error('This should not have happened');
    console.error(err);
  }
}

export default {
  error,
  warn,
  info,
  debug,
};
