const daemonrpc = require('daemonrpc');
const config = require('config');
const userconfig = require('../../../../config/userconfig');

const daemonConfig = require('./daemonConfig');

const fnconfig = new daemonConfig.DaemonConfig();

const { initial: { testnet: isTestnet } } = userconfig;

async function buildClient() {
  await fnconfig.resolvePaths();

  const rpcuser = fnconfig.rpcuser() || 'rpcuser';
  const rpcpassword = fnconfig.rpcpassword() || 'rpcpassword';
  const rpcport = fnconfig.rpcport() || (isTestnet === true ? config.daemon.rpcporttestnet : config.daemon.rpcport);

  const client = new daemonrpc.Client({
    port: rpcport,
    user: rpcuser,
    pass: rpcpassword,
    timeout: 60000,
  });

  return client;
}

module.exports = { buildClient };
