module.exports = {
  initial: {
    ipaddress: process.env.FLUX_NODE_IP || '127.0.0.1',
    zelid: process.env.FLUX_ADMIN_ZELID || '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    kadena: '',
    testnet: false,
    development: false,
    apiport: Number(process.env.FLUX_API_PORT) || 16127,
    routerIP: process.env.FLUX_ROUTER_IP || '',
    pgpPrivateKey: '',
    pgpPublicKey: '',
    blockedPorts: [],
    blockedRepositories: [],
  },
};
