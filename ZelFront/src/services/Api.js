import axios from 'axios';
import config from 'ZelBack/config/default';
import userconfig from 'Config/userconfig';

const store = require('store');

const port = config.server.apiport;
const externalip = userconfig.initial.ipaddress;

const { protocol, hostname } = window.location;
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

export { sourceCancelToken };

export default () => axios.create({
  baseURL: backendURL,
});
