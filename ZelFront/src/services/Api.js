
import axios from 'axios'

const config = require('../../../config/default')
const port = config.server.localport
const externalip = config.server.ipaddress

export default () => {
  return axios.create({
    baseURL: `http://${externalip}:${port}`
  })
}
