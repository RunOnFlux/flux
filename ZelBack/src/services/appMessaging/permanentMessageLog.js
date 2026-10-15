const config = require('config');
const { StringDecoder } = require('string_decoder');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const log = require('../../lib/log');

/**
 * The permanent message log of a range of block heights, as GET /apps/permanentmessagesbyheight
 * serves it: one stored message per line as JSON, in block height order, then one closing line.
 * The closing line is a success envelope carrying the number of messages before it, or an error
 * envelope when the log could not be read to the end. A message line never carries `status` and
 * the closing line always does, so a body without a success closing line whose count matches the
 * lines before it is incomplete, however its connection ended.
 *
 * Messages paid in one block come in no particular order.
 */
const MESSAGE_LOG_CONTENT_TYPE = 'application/x-ndjson';

// The server writes in pieces of about this size, so a log costs a cursor batch and one piece of
// memory however long it is.
const WRITE_PIECE_BYTES = 64 * 1024;

const globalAppsMessages = config.database.appsglobal.collections.appsMessages;

/**
 * @param {unknown} value a query parameter
 * @param {string} name
 * @returns {number}
 */
function blockHeight(value, name) {
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) {
    throw new Error(`${name} must be a block height`);
  }
  return Number(value);
}

/**
 * The inclusive block height range a request asks for.
 * @param {{fromHeight?: unknown, toHeight?: unknown}} query
 * @returns {{fromHeight: number, toHeight: number}}
 */
function heightRange(query) {
  const fromHeight = blockHeight(query.fromHeight, 'fromHeight');
  const toHeight = blockHeight(query.toHeight, 'toHeight');
  if (fromHeight > toHeight) throw new Error('fromHeight must not be above toHeight');
  return { fromHeight, toHeight };
}

/**
 * The stored permanent messages paid within a block height range, inclusive, in height order.
 * @param {{fromHeight: number, toHeight: number}} range
 * @returns {import('mongodb').FindCursor}
 */
function messagesByHeight({ fromHeight, toHeight }) {
  const db = dbHelper.databaseConnection();
  return db.db(config.database.appsglobal.database).collection(globalAppsMessages)
    .find({ height: { $gte: fromHeight, $lte: toHeight } }, { projection: { _id: 0 } })
    .sort({ height: 1 });
}

/**
 * Resolves when the response can take more, or when its connection has closed.
 * @param {import('http').ServerResponse} res
 * @returns {Promise<void>}
 */
function untilWritable(res) {
  return new Promise((resolve) => {
    function onClose() {
      resolve();
    }
    function onDrain() {
      res.off('close', onClose);
      resolve();
    }
    res.once('close', onClose);
    res.once('drain', onDrain);
  });
}

/**
 * Writes the log of a cursor's messages into a response and ends it. Stops, without ending the
 * response, once its connection has closed. When the cursor fails, every message it yielded has
 * been written before the error is thrown.
 * @param {import('http').ServerResponse} res
 * @param {AsyncIterable<object>} messages
 * @param {() => boolean} isClosed
 */
async function writeMessageLog(res, messages, isClosed) {
  let piece = '';
  let count = 0;
  try {
    // eslint-disable-next-line no-restricted-syntax
    for await (const message of messages) {
      if (isClosed()) return;
      piece += `${JSON.stringify(message)}\n`;
      count += 1;
      if (piece.length >= WRITE_PIECE_BYTES) {
        const flowing = res.write(piece);
        piece = '';
        // eslint-disable-next-line no-await-in-loop
        if (!flowing) await untilWritable(res);
        if (isClosed()) return;
      }
    }
  } catch (error) {
    if (piece.length > 0 && !isClosed()) res.write(piece);
    throw error;
  }
  if (isClosed()) return;
  res.end(`${piece}${JSON.stringify(messageHelper.createDataMessage({ count }))}\n`);
}

/**
 * GET /apps/permanentmessagesbyheight?fromHeight=&toHeight=
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getPermanentMessagesByHeightAPI(req, res) {
  let range;
  try {
    range = heightRange(req.query);
  } catch (error) {
    res.json(messageHelper.createErrorMessage(error.message, error.name, error.code));
    return;
  }

  let closed = false;
  res.once('close', function markClosed() {
    closed = true;
  });
  const cursor = messagesByHeight(range);
  res.setHeader('Content-Type', MESSAGE_LOG_CONTENT_TYPE);
  try {
    await writeMessageLog(res, cursor, () => closed);
  } catch (error) {
    log.error(`getPermanentMessagesByHeightAPI - ${range.fromHeight}-${range.toHeight}: ${error.message}`);
    const errorResponse = messageHelper.createErrorMessage(error.message, error.name, error.code);
    if (!res.headersSent) {
      res.removeHeader('Content-Type');
      res.json(errorResponse);
    } else if (!closed) {
      res.end(`${JSON.stringify(errorResponse)}\n`);
    }
  } finally {
    await cursor.close();
  }
}

/**
 * Reads a permanent message log, yielding each message as it arrives. Throws once the body ends
 * if it was incomplete: the messages yielded before that are still the peer's own, in height
 * order.
 * @param {AsyncIterable<Buffer>} body the decoded response body
 * @returns {AsyncGenerator<object>}
 */
async function* readMessageLog(body) {
  const decoder = new StringDecoder('utf8');
  let carry = '';
  let count = 0;
  let closing = null;

  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of body) {
    const lines = (carry + decoder.write(chunk)).split('\n');
    carry = lines.pop();
    // eslint-disable-next-line no-restricted-syntax
    for (const line of lines) {
      if (closing) throw new Error('message log continues past its closing line');
      const entry = JSON.parse(line);
      if (entry.status) {
        closing = entry;
      } else {
        count += 1;
        yield entry;
      }
    }
  }
  // A body that is a bare envelope, with no line break, is the server's answer to a request it
  // refused before the log began.
  const rest = carry + decoder.end();
  if (rest.length > 0) {
    const entry = JSON.parse(rest);
    if (closing || !entry.status) throw new Error('message log continues past its closing line');
    closing = entry;
  }

  if (!closing) throw new Error(`message log ended after ${count} messages without its closing line`);
  if (closing.status !== 'success') throw new Error(`peer could not read its message log: ${closing.data?.message}`);
  if (closing.data?.count !== count) throw new Error(`message log closed on ${closing.data?.count} messages, ${count} arrived`);
}

module.exports = {
  MESSAGE_LOG_CONTENT_TYPE,
  getPermanentMessagesByHeightAPI,
  heightRange,
  readMessageLog,
  writeMessageLog,
};
