import { Client } from 'daemonrpc';
import { Config } from 'fullnode';
import { config } from '../../../config/default.js';
import userconfig from '../../../../config/userconfig.js';

const fnconfig = new Config();
const isTestnet = userconfig.initial.testnet;
const rpcuser = fnconfig.rpcuser() || 'rpcuser';
const rpcpassword = fnconfig.rpcpassword() || 'rpcpassword';
const rpcport = fnconfig.rpcport() || (isTestnet === true ? config.daemon.rpcporttestnet : config.daemon.rpcport);

const client = new Client({
  port: rpcport,
  user: rpcuser,
  pass: rpcpassword,
  timeout: 60000,
});

const _default = client;
export { _default as default };
