
import axios from 'axios'

const fullnode = require('fullnode')
const config = require('../../../config/default')

const port = config.server.localport
const zelnodeConfig = new fullnode.Config()
const externalip = zelnodeConfig.get('externalip')

export default () => {
  return axios.create({
    baseURL: `http://${externalip}:${port}`
  })
}
