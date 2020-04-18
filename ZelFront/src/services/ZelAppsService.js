import Api from '@/services/Api';

export default {
  listRunningZelApps() {
    return Api().get('/zelapps/listrunningzelapps');
  },
  listAllZelApps() {
    return Api().get('/zelapps/listallzelapps');
  },
  installedZelApps() {
    return Api().get('/zelapps/installedzelapps');
  },
  stopZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelappstop/${zelapp}`, axiosConfig);
  },
  startZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelappstart/${zelapp}`, axiosConfig);
  },
  restartZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelapprestart/${zelapp}`, axiosConfig);
  },
  removeZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelappremove/${zelapp}`, axiosConfig);
  },
  zelAppLogs(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelapplog/${zelapp}`, axiosConfig);
  },
  installFoldingAtHome(zelidauthHeader) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get('/zelapps/zelapptemporarylocalregister/foldingathome', axiosConfig);
  },
};
