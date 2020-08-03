import Api from '@/services/Api';

export default {
  listRunningZelApps() { return Api().get('/zelapps/listrunningzelapps');},
  listAllZelApps() { return Api().get('/zelapps/listallzelapps');},
  installedZelApps() { return Api().get('/zelapps/installedzelapps');},
  availableZelApps() { return Api().get('/zelapps/availablezelapps');},
  stopZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelappstop/${zelapp}`, axiosConfig);
  },
  startZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelappstart/${zelapp}`, axiosConfig);
  },
  restartZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelapprestart/${zelapp}`, axiosConfig);
  },
  removeZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
      onDownloadProgress(progressEvent) { console.log(progressEvent); },
    };
    return Api().get(`/zelapps/zelappremove/${zelapp}`, axiosConfig);
  },
  zelAppLogs(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
      onDownloadProgress(progressEvent) { console.log(progressEvent); },
    };
    return Api().get(`/zelapps/zelapplog/${zelapp}`, axiosConfig);
  },
  registerZelApp(zelidauthHeader, data) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().post('/zelapps/zelappregister', JSON.stringify(data),
                      axiosConfig);
  },
  checkCommunication() { return Api().get('/zelflux/checkcommunication');},
  chekcDockerExistance(zelidauthHeader, data) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().post('/zelapps/checkdockerexistance', JSON.stringify(data),
                      axiosConfig);
  },
  zelappsRegInformation() {
    return Api().get('/zelapps/registrationinformation');
  },
  getZelAppLocation(name) { return Api().get(`/zelapps/location/${name}`);},
  globalZelAppSpecifications() {
    return Api().get('/zelapps/globalspecifications');
  },
  reindexGlobalApps(zelidauthHeader) {
    return Api().get('/zelapps/reindexglobalappsinformation', {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  reindexLocations(zelidauthHeader) {
    return Api().get('/zelapps/reindexglobalappslocation', {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  rescanGlobalApps(zelidauthHeader, height, removelastinformation) {
    return Api().get(`/zelapps/rescanglobalappsinformation/${height}/${
                         removelastinformation}`,
                     {
                       headers : {
                         zelidauth : zelidauthHeader,
                       },
                     });
  },
  justAPI() { return Api();},
};
