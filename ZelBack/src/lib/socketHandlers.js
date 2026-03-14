const idService = require('../services/idService');
const paymentService = require('../services/paymentService');
const { peerManager } = require('../services/utils/peerState');

// these need to be most specific first (on the same route)
const socketHandlers = {
  '/ws/flux/:port': peerManager.validateAndAddInbound.bind(peerManager),
  '/ws/flux': peerManager.validateAndAddInbound.bind(peerManager),
  '/ws/id/:loginphrase': idService.wsRespondLoginPhrase,
  '/ws/sign/:message': idService.wsRespondSignature,
  '/ws/payment/:paymentid': paymentService.wsRespondPayment,
};

module.exports = socketHandlers;
