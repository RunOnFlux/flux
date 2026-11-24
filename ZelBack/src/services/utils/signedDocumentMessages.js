// The peer messages of each signed document SignedDocumentExchange carries.
//
// Three types per document, and a capability a peer advertises when it speaks them:
//
//   seq       the sequence the sender holds, or null when it holds none. Sent both ways: as an
//             adoption announcement to every capable peer, and as the answer to an ask the
//             sender has nothing newer for. Point to point, never relayed.
//   request   the sequence the asker holds, sent to one named peer.
//   document  the signed bytes, in `field`, as the answer to an ask the sender is ahead of.

const POLICY = Object.freeze({
  seq: 'fluxpolicyseq',
  request: 'fluxpolicyrequest',
  document: 'fluxpolicy',
  field: 'bundle',
  capability: 'policyBundle',
});

module.exports = { POLICY };
