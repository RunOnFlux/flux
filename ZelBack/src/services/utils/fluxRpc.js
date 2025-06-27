const axios = require('axios');

const fluxController = require('./fluxController');

class FluxRpc {
  static #methodMap = {
    fluxd: new Map([
      // == Addressindex ==
      ['getaddressbalance', null],
      ['getaddressdeltas', null],
      ['getaddressmempool', null],
      ['getaddresstxids', null],
      ['getaddressutxos', null],
      // == Benchmarks ==
      ['getbenchmarks', null],
      ['getbenchstatus', null],
      ['startfluxbenchd', null],
      ['startzelbenchd', null],
      ['stopfluxbenchd', null],
      ['stopzelbenchd', null],
      // == Blockchain ==
      ['getbestblockhash', null],
      ['getblock', null],
      ['getblockchaininfo', null],
      ['getblockcount', null],
      ['getblockdeltas', null],
      ['getblockhash', null],
      ['getblockhashes', null],
      ['getblockheader', null],
      ['getchaintips', null],
      ['getdifficulty', null],
      ['getmempoolinfo', null],
      ['getrawmempool', null],
      ['getspentinfo', null],
      ['gettxout', null],
      ['gettxoutproof', null],
      ['gettxoutsetinfo', null],
      ['verifychain', null],
      ['verifytxoutproof', null],
      // == Control ==
      ['getinfo', null],
      ['help', null],
      ['stop', null],
      // == Disclosure ==
      ['z_getpaymentdisclosure', null],
      ['z_validatepaymentdisclosure', null],
      // == Fluxnode ==
      ['createconfirmationtransaction', null],
      ['createfluxnodekey', null],
      ['createp2shstarttx', null],
      ['createzelnodekey', null],
      ['fluxnodecurrentwinner', null],
      ['getdoslist', null],
      ['getfluxnodecount', null],
      ['getfluxnodeoutputs', null],
      ['getfluxnodestatus', null],
      ['getmigrationcount', null],
      ['getstartlist', null],
      ['getzelnodecount', null],
      ['getzelnodeoutputs', null],
      ['getzelnodestatus', null],
      ['listfluxnodeconf', null],
      ['listfluxnodes', null],
      ['listzelnodeconf', null],
      ['listzelnodes', null],
      ['sendp2shstarttx', null],
      ['signp2shstarttx', null],
      ['startdeterministicfluxnode', null],
      ['startdeterministiczelnode', null],
      ['startfluxnode', null],
      ['startzelnode', null],
      ['viewdeterministicfluxnodelist', null],
      ['viewdeterministiczelnodelist', null],
      ['zelnodecurrentwinner', null],
      // == Generating ==
      ['generate', null],
      ['getgenerate', null],
      ['setgenerate', null],
      // == Mining ==
      ['getblocksubsidy', null],
      ['getblocktemplate', null],
      ['getlocalsolps', null],
      ['getmininginfo', null],
      ['getnetworkhashps', null],
      ['getnetworksolps', null],
      ['prioritisetransaction', null],
      ['submitblock', null],
      // == Network ==
      ['addnode', null],
      ['clearbanned', null],
      ['disconnectnode', null],
      ['getaddednodeinfo', null],
      ['getconnectioncount', null],
      ['getdeprecationinfo', null],
      ['getnettotals', null],
      ['getnetworkinfo', null],
      ['getpeerinfo', null],
      ['listbanned', null],
      ['ping', null],
      ['setban', null],
      // == Rawtransactions ==
      ['createrawtransaction', null],
      ['decoderawblock', null],
      ['decoderawtransaction', null],
      ['decodescript', null],
      ['fundrawtransaction', null],
      ['getrawtransaction', null],
      ['sendrawtransaction', null],
      ['signrawtransaction', null],
      // == Util ==
      ['createmultisig', null],
      ['estimatefee', null],
      ['estimatepriority', null],
      ['printsnapshot', null],
      ['validateaddress', null],
      ['verifymessage', null],
      ['z_validateaddress', null],
      // == Wallet ==
      ['addmultisigaddress', null],
      ['backupwallet', null],
      ['consolidateutxos', null],
      ['dumpprivkey', null],
      ['dumpwallet', null],
      ['encryptwallet', null],
      ['getaccount', null],
      ['getaccountaddress', null],
      ['getaddressesbyaccount', null],
      ['getbalance', null],
      ['getnewaddress', null],
      ['getrawchangeaddress', null],
      ['getreceivedbyaccount', null],
      ['getreceivedbyaddress', null],
      ['gettransaction', null],
      ['getunconfirmedbalance', null],
      ['getwalletinfo', null],
      ['importaddress', null],
      ['importprivkey', null],
      ['importwallet', null],
      ['keypoolrefill', null],
      ['listaccounts', null],
      ['listaddressgroupings', null],
      ['listlockunspent', null],
      ['listreceivedbyaccount', null],
      ['listreceivedbyaddress', null],
      ['listsinceblock', null],
      ['listtransactions', null],
      ['listunspent', null],
      ['lockunspent', null],
      ['move', null],
      ['rescanblockchain', null],
      ['sendfrom', null],
      ['sendmany', null],
      ['sendtoaddress', null],
      ['setaccount', null],
      ['settxfee', null],
      ['signmessage', null],
      ['z_exportkey', null],
      ['z_exportviewingkey', null],
      ['z_exportwallet', null],
      ['z_getbalance', null],
      ['z_getmigrationstatus', null],
      ['z_getnewaddress', null],
      ['z_getoperationresult', null],
      ['z_getoperationstatus', null],
      ['z_gettotalbalance', null],
      ['z_importkey', null],
      ['z_importviewingkey', null],
      ['z_importwallet', null],
      ['z_listaddresses', null],
      ['z_listoperationids', null],
      ['z_listreceivedbyaddress', null],
      ['z_listunspent', null],
      ['z_mergetoaddress', null],
      ['z_sendmany', null],
      ['z_setmigration', null],
      ['z_shieldcoinbase', null],
      ['zcbenchmark', null],
      ['zcrawjoinsplit', null],
      ['zcrawkeygen', null],
      ['zcrawreceive', null],
      ['zcsamplejoinsplit', null],
    ]),
    fluxbenchd: new Map([
      ['getstatus', null],
      ['restartnodebenchmarks', null],
      ['signzelnodetransaction', null],
      ['getbenchmarks', null],
      ['getpublicip', null],
      ['startmultiportbench', null],
      ['help', null],
      ['stop', null],
      ['getinfo', null],
      ['decryptmessage', null],
      ['getpublickey', null],
      ['decryptrsamessage', null],
      ['encryptmessage', null],
    ]),
  };

  #currentId = 0;

  #instance = null;

  constructor(uri, options = {}) {
    // just throw if bad option
    const parsed = new URL(uri);
    this.url = parsed.origin;

    this.auth = options.auth || null;
    this.mode = options.mode || 'fluxd';
    // Originally, this timeout was 60s. However, it got lowered to 10s. Which,
    // due to the chaintips call, is too low. On a Stratus (with average CPU) this
    // call was about 14s. Now we set it to defauolt 60s here, and the callee can
    // set whatever timeout they want (should make this option overrideable per call)
    const timeout = options.timeout || 60_000;

    if (!(['fluxd', 'fluxbenchd'].includes(this.mode))) {
      throw new Error('mode must be one of fluxd | fluxbenchd');
    }

    this.controller = options.controller || new fluxController.FluxController();

    // we don't use the serviceHelper methods here to avoid adding these calls to debug
    this.#instance = axios.create({ baseURL: this.url, auth: this.auth, timeout });

    this.methods = FluxRpc.#methodMap[this.mode];
  }

  #createPayload(method, params) {
    const id = this.#currentId;

    this.#currentId = (id + 1) % 1000;

    return {
      jsonrpc: '2.0', id, method, params,
    };
  }

  async run(rawMethod, options = {}) {
    const params = options.params || [];

    if (!(params instanceof Array)) throw new Error('Params must be an Array');

    const method = rawMethod.toLowerCase();

    if (!this.methods.has(method)) throw new Error(`Invalid Method: ${method}`);

    const payload = this.#createPayload(method, params);
    const { signal } = this.controller;

    // by default, axios throws for any non 2XX response code
    const res = await this.#instance.post('/', payload, { signal }).catch((err) => {
      const { response: { data } = {} } = err;

      let errorMessage;
      let errorCode;

      if (typeof data === 'string') {
        errorCode = 500;
        errorMessage = data;
      } else if (data) {
        const { code: rpcErrorCode, message: rpcErrorMsg } = data.error;

        errorCode = rpcErrorCode;
        errorMessage = rpcErrorMsg;
      }

      errorCode = errorCode || err.code;
      errorMessage = errorMessage || err.message;

      const fetchError = new Error(errorMessage);
      fetchError.code = errorCode;

      throw fetchError;
    });

    const { status: axiosStatus, data: axiosData } = res;

    // I don't think this ever happens i.e. 204 etc
    if (axiosStatus !== 200) {
      const resError = new Error(`Invalid response status code: ${axiosStatus}`);
      resError.code = 'INVALID_STATUS_CODE';
      throw resError;
    }

    const { result } = axiosData;

    return result;
  }
}

async function main() {
  const auth = {
    username: 'test',
    password: 'test',
  };

  const fluxRpc = new FluxRpc('http://127.0.0.1:16124', { auth });
  console.log(await fluxRpc.run('getfluxnodestatus'));
}

if (require.main === module) {
  main();
}

module.exports = { FluxRpc };
