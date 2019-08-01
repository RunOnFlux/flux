const zelcashrpc = require('zelcashrpc')
const fullnode = require('fullnode')

async function defaultResponse(req, res) {
  const config = new fullnode.Config()
  const rpcuser = config.rpcuser() || 'rpcuser'
  const rpcpassword = config.rpcpassword() || 'rpcpassowrd'
  const rpcport = config.rpcport() || 16124

  const client = new zelcashrpc.Client({
    port: rpcport,
    user: rpcuser,
    pass: rpcpassword,
    timeout: 60000
  })

  const response = {
    status: 'success',
    data: 'Welcome to ZelNode network!'
  }

  try {
    const data = await client.getInfo()
    response.status = 'success'
    response.data = data
  } catch (err) {
    response.status = 'error'
    response.data = err
  }

  return res.json(response)
}

module.exports = {
  defaultResponse: defaultResponse
}
