const { parentPort } = require('node:worker_threads');

parentPort.on('message', (nodes) => {
  const pubkeyIndex = new Map();
  const endpointIndex = new Map();

  nodes.forEach((node) => {
    const nodesByPubkey = pubkeyIndex.get(node.pubkey)
      || pubkeyIndex.set(node.pubkey, new Map()).get(node.pubkey);

    nodesByPubkey.set(node.ip, node);
    endpointIndex.set(node.ip, node);
  });

  parentPort.postMessage({ pubkeyIndex, endpointIndex });
});

//     nodes.forEach((node) => {
//       if (!this.#pubkeyIndex.has(node.pubkey)) {
//         this.#pubkeyIndex.set(node.pubkey, new Map());
//       }
//       this.#pubkeyIndex.get(node.pubkey).set(node.ip, node);
//       this.#endpointIndex.set(node.ip, node);
//     });
