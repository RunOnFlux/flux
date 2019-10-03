// inspired by bitcoin-promise packackge

let bitcoin = require('bitcoin')

let zelcashMethods = [
  'getBlockHeader',
  'getBlockSubsidy',
  'getLocalSolPs',
  'getNetworkSolPs',
  'disconnectNode',
  'clearBanned',
  'getDeprecationInfo',
  'listBanned',
  'setBan',
  'fundRawTransaction',
  'z_getpaymentdisclosure',
  'z_validatepaymentdisclosure',
  'z_validateaddress',
  'z_exportviewingkey',
  'z_importviewingkey',
  'z_getmigrationstatus',
  'z_getoperationstatus',
  'z_listoperationids',
  'z_mergetoaddress',
  'z_setmigration',
  'z_shieldcoinbase',
  'z_listunspent',
  'z_listaddresses',
  'z_listreceivedbyaddress',
  'z_getoperationresult',
  'z_getbalance',
  'z_gettotalbalance',
  'z_getnewaddress',
  'z_sendmany',
  'z_exportkey',
  'z_exportwallet',
  'z_importkey',
  'zcbenchmark',
  'zcrawjoinsplit',
  'zcrawkeygen',
  'zcrawreceive',
  'zcsamplejoinsplit',
  'createzelnodebroadcast',
  'decodezelnodebroadcast',
  'getnodebenchmarks',
  'getzelnodescores',
  'getzelnodewinners',
  'relayzelnodebroadcast',
  'spork',
  'zelnodecurrentwinner',
  'zelnodedebug',
  'znsync',
  'createzelnodekey',
  'getzelnodeoutputs',
  'startzelnode',
  'getzelnodestatus',
  'listzelnodes',
  'getzelnodecount',
  'listzelnodeconf'
]
// ===----------------------------------------------------------------------===//
// callRpc
// ===----------------------------------------------------------------------===//
function callRpc(cmd, args, rpc) {
  let promise = null
  let fn = args[args.length - 1]

  // If the last argument is a callback, pop it from the args list
  if (typeof fn === 'function') {
    args.pop()
    rpc.call(cmd, args, function () {
      let args = [].slice.call(arguments)
      args.unshift(null)
      fn.apply(this, args)
    }, function (err) {
      fn(err)
    })
  } else {
    // .....................................................
    // if no callback function is passed - return a promise
    // .....................................................
    promise = new Promise(function (resolve, reject) {
      rpc.call(cmd, args, function () {
        let args = [].slice.call(arguments)
        args.unshift(null)
        // ----------------------
        // args is err,data,hdrs
        // but we can only pass 1 thing back
        // rather than make a compound object - ignore the headers
        // errors are handled in the reject below
        resolve(args[1])
      }, function (err) {
        reject(err)
      })
    })
    // Return the promise here
    return promise
  }
}

(function () {
  let methods = Object.getOwnPropertyNames(bitcoin.Client.prototype).filter(function (p) {
    return typeof bitcoin.Client.prototype[p] === 'function' && p !== 'cmd' && p !== 'constructor'
  })
  for (let i = 0; i < methods.length; i++) {
    let protoFn = methods[i];
    (function (protoFn) {
      bitcoin.Client.prototype[protoFn] = function () {
        let args = [].slice.call(arguments)
        return callRpc(protoFn.toLowerCase(), args, this.rpc)
      }
    })(protoFn)
  }

  for (let i = 0; i < zelcashMethods.length; i++) {
    let protoFn = zelcashMethods[i];
    (function (protoFn) {
      bitcoin.Client.prototype[protoFn] = function () {
        let args = [].slice.call(arguments)
        return callRpc(protoFn.toLowerCase(), args, this.rpc)
      }
    })(protoFn)
  }
})()

module.exports.Client = bitcoin.Client
