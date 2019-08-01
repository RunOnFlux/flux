
import axios from 'axios'
const config = require('../../../config/default')
const port = config.server.localport
export default () => {
  return axios.create({
    baseURL: `http://localhost:${port}`
  })
}
