import axios from 'axios';

const store = require('store');

const config = require('../../../ZelBack/config/default');
const userconfig = require('../../../config/userconfig');

const port = config.server.apiport;
const externalip = userconfig.initial.ipaddress;

const {protocol, hostname} = window.location;
let mybackend = '';
mybackend += protocol;
mybackend += '//';
const regex = /[A-Za-z]/g;
if (hostname.match(regex)) {
  const names = hostname.split('.');
  names[0] = 'api';
  mybackend += names.join('.');
} else {
  mybackend += externalip;
  mybackend += ':';
  mybackend += port;
}

const backendURL = store.get('backendURL') || mybackend;

const sourceCancelToken = axios.CancelToken.source();

export {sourceCancelToken};

export default () => axios.create({
  baseURL : backendURL,
});
