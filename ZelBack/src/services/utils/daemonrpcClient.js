const daemonrpc = require('daemonrpc');
const fullnode = require('fullnode');
const config = require('config');

userconfig = require('../../../../config/userconfig');

const { initial: isTestnet } = userconfig;

const fnconfig = new fullnode.Config();

const rpcuser = fnconfig.rpcuser() || 'rpcuser';
const rpcpassword = fnconfig.rpcpassword() || 'rpcpassword';
const rpcport = fnconfig.rpcport() || (isTestnet === true ? config.daemon.rpcporttestnet : config.daemon.rpcport);

const client = new daemonrpc.Client({
  port: rpcport,
  user: rpcuser,
  pass: rpcpassword,
  timeout: 60000,
});

module.exports.default = client;
