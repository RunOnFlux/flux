const idService = require('../services/idService');
const paymentService = require('../services/paymentService');
const fluxCommunication = require('../services/fluxCommunication');

// these need to be most specific first (on the same route)
const socketHandlers = {
  '/ws/flux/:port': fluxCommunication.handleIncomingConnection,
  '/ws/flux': fluxCommunication.handleIncomingConnection,
  '/ws/id/:loginphrase': idService.wsRespondLoginPhrase,
  '/ws/sign/:message': idService.wsRespondSignature,
  '/ws/payment/:paymentid': paymentService.wsRespondPayment,
};

module.exports = socketHandlers;
