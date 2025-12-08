const config = require('config');
const qs = require('qs');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const dbHelper = require('./dbHelper');

// Constants for validation
const MAX_BODY_SIZE = 10000; // 10KB max for payment callbacks
const TXID_MAX_LENGTH = 500; // Support any transaction format
const COIN_MAX_LENGTH = 50; // Support any coin ticker
const ADDRESS_MIN_LENGTH = 10;
const ADDRESS_MAX_LENGTH = 500; // Support any address format
const PAYMENT_REQUEST_VALIDITY = 60 * 60 * 1000; // 1 hour in ms
const WS_POLLING_INTERVAL = 500; // ms
const WS_MAX_POLLING_TIME = 65 * 60 * 1000; // 65 minutes (slightly longer than payment validity)

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
      expireAt: new Date(timestamp + PAYMENT_REQUEST_VALIDITY),
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
    // Prevent memory exhaustion from large payloads
    if (body.length > MAX_BODY_SIZE) {
      req.destroy();
      const errMessage = messageHelper.createErrorMessage('Request body too large');
      res.status(413).json(errMessage);
    }
  });
  req.on('end', async () => {
    try {
      if (body.length > MAX_BODY_SIZE) {
        return; // Already handled above
      }

      const processedBody = serviceHelper.ensureObject(body);
      // Support both transaction_id (from ZelCore) and txid
      const txid = processedBody.transaction_id || processedBody.txid;
      const {
        coin, chain, explorer, amount,
      } = processedBody;
      // eslint-disable-next-line camelcase
      const { from_address, to_address } = processedBody;
      const paymentId = req.query.paymentid || processedBody.paymentid;

      // Validate payment ID
      if (!paymentId) {
        throw new Error('No payment ID is specified');
      }
      if (typeof paymentId !== 'string' || paymentId.length < 10 || paymentId.length > 100) {
        throw new Error('Invalid payment ID format');
      }

      // Validate transaction ID
      if (!txid) {
        throw new Error('No transaction ID is specified');
      }
      if (typeof txid !== 'string') {
        throw new Error('Transaction ID must be a string');
      }
      // Support any transaction format, just limit length
      if (txid.length < 1 || txid.length > TXID_MAX_LENGTH) {
        throw new Error('Invalid transaction ID length');
      }

      // Validate coin
      if (!coin) {
        throw new Error('No coin is specified');
      }
      if (typeof coin !== 'string') {
        throw new Error('Coin must be a string');
      }
      if (coin.length < 1 || coin.length > COIN_MAX_LENGTH) {
        throw new Error('Invalid coin name length');
      }

      // Validate optional addresses if provided
      // eslint-disable-next-line camelcase
      if (from_address) {
        // eslint-disable-next-line camelcase
        if (typeof from_address !== 'string') {
          throw new Error('From address must be a string');
        }
        // eslint-disable-next-line camelcase
        if (from_address.length < ADDRESS_MIN_LENGTH || from_address.length > ADDRESS_MAX_LENGTH) {
          throw new Error('Invalid from address length');
        }
      }
      // eslint-disable-next-line camelcase
      if (to_address) {
        // eslint-disable-next-line camelcase
        if (typeof to_address !== 'string') {
          throw new Error('To address must be a string');
        }
        // eslint-disable-next-line camelcase
        if (to_address.length < ADDRESS_MIN_LENGTH || to_address.length > ADDRESS_MAX_LENGTH) {
          throw new Error('Invalid to address length');
        }
      }

      // Validate amount if provided
      if (amount !== undefined && amount !== '') {
        const numAmount = Number(amount);
        if (Number.isNaN(numAmount) || numAmount <= 0) {
          throw new Error('Amount must be a positive number');
        }
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
        // Check if expired
        if (+result.createdAt < (timestamp - PAYMENT_REQUEST_VALIDITY)) {
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
          // eslint-disable-next-line camelcase
          fromAddress: from_address || '',
          // eslint-disable-next-line camelcase
          toAddress: to_address || '',
          amount: amount || '',
          createdAt: new Date(timestamp),
        };

        await dbHelper.insertOneToDatabase(database, completedPaymentsCollection, newPayment);

        const resData = {
          message: 'Payment received successfully',
          paymentId,
          txid,
          success_url: 'https://home.runonflux.io/successcheckout',
        };
        const resMessage = messageHelper.createDataMessage(resData);
        res.json(resMessage);

        // Clean up active payment request with proper error handling
        setTimeout(() => {
          dbHelper.findOneAndDeleteInDatabase(database, activePaymentsCollection, query, projection)
            .catch((error) => {
              log.error(`Failed to cleanup active payment request ${paymentId}: ${error.message}`);
            });
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
  const startTime = Date.now();

  // eslint-disable-next-line no-param-reassign
  ws.onclose = (evt) => {
    log.info(`WebSocket payment listener closed with code: ${evt.code}`);
    connclosed = true;
  };

  // eslint-disable-next-line no-param-reassign
  ws.onerror = (evt) => {
    log.error(`WebSocket payment listener error: ${evt.code}`);
    connclosed = true;
  };

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.completedPayments;
  const query = { paymentId: paymentid };
  const projection = {};

  async function searchDatabase() {
    // Check for max polling timeout to prevent indefinite polling
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > WS_MAX_POLLING_TIME) {
      log.warn(`WebSocket payment polling timeout reached for ${paymentid}`);
      const errMessage = messageHelper.createErrorMessage('Payment polling timeout reached. Please request a new payment.');
      if (!connclosed) {
        try {
          ws.send(qs.stringify(errMessage));
          ws.close(4016);
        } catch (e) {
          log.error(e);
        }
      }
      return;
    }

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
          fromAddress: result.fromAddress,
          toAddress: result.toAddress,
          amount: result.amount,
          receivedAt: result.receivedAt || result.createdAt,
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
          // Payment request still active, check again
          setTimeout(() => {
            if (!connclosed) {
              searchDatabase();
            }
          }, WS_POLLING_INTERVAL);
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
