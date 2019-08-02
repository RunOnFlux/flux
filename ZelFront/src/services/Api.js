
import axios from 'axios'
const ip = require('ip')
const config = require('../../../config/default')
const port = config.server.localport
const ipaddr = ip.address()
export default () => {
  return axios.create({
    baseURL: `http://${ipaddr}:${port}`
  })
}
