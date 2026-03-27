const net = require('net');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');

const mongoHost = config.database.url || '127.0.0.1';
const mongoPort = config.database.port || 27017;

let mongoAvailable = null; // null = not checked yet

/**
 * Fast TCP check — resolves in <200ms if MongoDB isn't listening.
 * @returns {Promise<boolean>}
 */
function isMongoReachable() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(200);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(mongoPort, mongoHost);
  });
}

/**
 * Drop-in replacement for `await dbHelper.initiateDB()` in test `before` hooks.
 * Must be called with a regular `function` (not arrow) so `this.skip()` works.
 *
 * Usage:
 *   before(requireMongo);
 *   // or inside an existing before:
 *   before(async function() {
 *     await requireMongo.call(this);
 *     // ... other setup
 *   });
 */
async function requireMongo() {
  if (mongoAvailable === null) {
    mongoAvailable = await isMongoReachable();
  }
  if (!mongoAvailable) {
    this.skip();
    return;
  }
  await dbHelper.initiateDB();
}

module.exports = { requireMongo, isMongoReachable };
