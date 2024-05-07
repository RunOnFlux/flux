import axios from 'axios';

const store = require('store');

const { protocol, hostname, port } = window.location;
let mybackend = '';
mybackend += protocol;
mybackend += '//';
const regex = /[A-Za-z]/g;
if (hostname.split('-')[4]) { // node specific domain
  const splitted = hostname.split('-');
  const names = splitted[4].split('.');
  const adjP = +names[0] + 1;
  names[0] = adjP.toString();
  names[2] = 'api';
  splitted[4] = '';
  mybackend += splitted.join('-');
  mybackend += names.join('.');
} else if (hostname.match(regex)) { // home.runonflux.io -> api.runonflux.io
  const names = hostname.split('.');
  names[0] = 'api';
  mybackend += names.join('.');
} else {
  mybackend += hostname;
  mybackend += ':';
  mybackend += (+port + 1);
}

const sourceCancelToken = axios.CancelToken.source();

export { sourceCancelToken };

export default () => axios.create({

  baseURL: store.get('backendURL') || mybackend,
});
