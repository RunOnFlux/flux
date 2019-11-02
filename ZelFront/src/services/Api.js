
import axios from 'axios';

const config = require('../../../config/default');
const userconfig = require('../../../config/userconfig');

const port = config.server.apiport;
const externalip = userconfig.initial.ipaddress;

export default () => axios.create({
  baseURL: `http://${externalip}:${port}`,
});
