
import axios from 'axios';

const store = require('store');

const config = require('../../../ZelBack/config/default');
const userconfig = require('../../../config/userconfig');

const port = config.server.apiport;
const externalip = userconfig.initial.ipaddress;

const backendURL = store.get('backendURL') || `http://${externalip}:${port}`;

export default () => axios.create({
  baseURL: backendURL,
});
