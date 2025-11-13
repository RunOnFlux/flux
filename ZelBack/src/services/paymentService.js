const config = require('config');
const qs = require('qs');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const dbHelper = require('./dbHelper');

/**
 * To return a JSON response with a payment request ID.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function paymentRequest(req, res) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.activePaymentRequests;

    // Generate unique payment request ID
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const paymentId = `${timestamp}_${randomString}`;

    const newPaymentRequest = {
      paymentId,
      createdAt: new Date(timestamp),
      expireAt: new Date(timestamp + (60 * 60 * 1000)), // valid for 1 hour
    };

    await dbHelper.insertOneToDatabase(database, collection, newPaymentRequest);
    const resData = { paymentId };
    const resMessage = messageHelper.createDataMessage(resData);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To receive and verify payment callback from ZelCore.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function verifyPayment(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const { txid, coin, chain, explorer } = processedBody;
      const paymentId = req.query.paymentid || processedBody.paymentid;

      if (!paymentId) {
        throw new Error('No payment ID is specified');
      }

      if (!txid) {
        throw new Error('No transaction ID is specified');
      }

      if (!coin) {
        throw new Error('No coin is specified');
      }

      // Verify payment request exists and is still valid
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const activePaymentsCollection = config.database.local.collections.activePaymentRequests;
      const query = { paymentId };
      const projection = {};
      const result = await dbHelper.findOneInDatabase(database, activePaymentsCollection, query, projection);

      if (result) {
        const timestamp = Date.now();
        // Check if expired (1 hour = 3600000 ms)
        if (+result.createdAt < (timestamp - 3600000)) {
          throw new Error('Payment request has expired');
        }

        // Store the payment information
        const completedPaymentsCollection = config.database.local.collections.completedPayments;
        const newPayment = {
          paymentId,
          txid,
          coin,
          chain: chain || coin,
          explorer: explorer || '',
          receivedAt: new Date(timestamp),
        };

        await dbHelper.insertOneToDatabase(database, completedPaymentsCollection, newPayment);

        const resData = {
          message: 'Payment received successfully',
          paymentId,
          txid,
        };
        const resMessage = messageHelper.createDataMessage(resData);
        res.json(resMessage);

        // Clean up active payment request
        setTimeout(async () => {
          await dbHelper.findOneAndDeleteInDatabase(database, activePaymentsCollection, query, projection);
        }, 1000);
      } else {
        throw new Error('Payment request not found or has expired');
      }
    } catch (error) {
      log.error(error);
      const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
      res.json(errMessage);
    }
  });
}

/**
 * To check if a payment has been received via websocket.
 * @param {object} ws Web socket.
 * @param {string} paymentid Payment ID.
 */
async function wsRespondPayment(ws, paymentid) {
  let connclosed = false;

  ws.onclose = (evt) => {
    console.log(evt.code);
    connclosed = true;
  };

  ws.onerror = (evt) => {
    log.error(evt.code);
    connclosed = true;
  };

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.completedPayments;
  const query = { paymentId: paymentid };
  const projection = {};

  async function searchDatabase() {
    try {
      const result = await dbHelper.findOneInDatabase(database, collection, query, projection).catch((error) => {
        const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
        ws.send(qs.stringify(errMessage));
        ws.close(4011);
        throw error;
      });

      if (result) {
        // Payment received
        const resData = {
          message: 'Payment received',
          paymentId: result.paymentId,
          txid: result.txid,
          coin: result.coin,
          chain: result.chain,
          explorer: result.explorer,
          receivedAt: result.receivedAt,
        };
        const message = messageHelper.createDataMessage(resData);
        if (!connclosed) {
          try {
            ws.send(qs.stringify(message));
            ws.close(4012);
          } catch (e) {
            log.error(e);
          }
        }
      } else {
        // Check if payment request is still active
        const activePaymentsCollection = config.database.local.collections.activePaymentRequests;
        const resultB = await dbHelper.findOneInDatabase(database, activePaymentsCollection, query, projection).catch((error) => {
          const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
          ws.send(qs.stringify(errMessage));
          ws.close(4013);
          throw error;
        });

        if (resultB) {
          // Payment request still active, check again in 500ms
          setTimeout(() => {
            if (!connclosed) {
              searchDatabase();
            }
          }, 500);
        } else {
          const errMessage = messageHelper.createErrorMessage('Payment request is no longer valid. Please request a new one.');
          if (!connclosed) {
            try {
              ws.send(qs.stringify(errMessage));
              ws.close();
            } catch (e) {
              log.error(e);
            }
          }
        }
      }
    } catch (error) {
      log.error(error);
    }
  }

  searchDatabase();
}

module.exports = {
  paymentRequest,
  verifyPayment,
  wsRespondPayment,
};
