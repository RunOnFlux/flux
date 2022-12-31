import axios from 'axios';
import { store } from '@/store';

const { protocol, hostname, port } = window.location;
let mybackend = '';
mybackend += protocol;
mybackend += '//';
const regex = /[A-Za-z]/g;
if (hostname.match(regex)) {
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

const storeMap = new Map(Object.entries(store));

export default () => axios.create({
  baseURL: storeMap.get('backendURL') || mybackend,
});
