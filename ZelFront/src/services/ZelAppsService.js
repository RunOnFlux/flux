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
  pauseZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelapppause/${zelapp}`, axiosConfig);
  },
  unpauseZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelappunpause/${zelapp}`, axiosConfig);
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
  registerZelApp(zelidauthHeader, data) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().post('/zelapps/zelappregister', JSON.stringify(data),
                      axiosConfig);
  },
  updateZelApp(zelidauthHeader, data) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().post('/zelapps/zelappupdate', JSON.stringify(data),
                      axiosConfig);
  },
  checkCommunication() { return Api().get('/zelflux/checkcommunication');},
  checkDockerExistance(zelidauthHeader, data) {
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
    return Api().get('/zelapps/globalappsspecifications');
  },
  getInstalledZelAppSpecifics(
      name) { return Api().get(`/zelapps/installedzelapps/${name}`);},
  getZelAppSpecifics(
      name) { return Api().get(`/zelapps/appspecifications/${name}`);},
  getZelAppOwner(name) { return Api().get(`/zelapps/appowner/${name}`);},
  getZelAppLogsTail(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelapplog/${zelapp}/100`, axiosConfig);
  },
  getZelAppTop(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelapptop/${zelapp}`, axiosConfig);
  },
  getZelAppInspect(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelappinspect/${zelapp}`, axiosConfig);
  },
  getZelAppStats(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelappstats/${zelapp}`, axiosConfig);
  },
  getZelAppChanges(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().get(`/zelapps/zelappchanges/${zelapp}`, axiosConfig);
  },
  getZelAppExec(zelidauthHeader, zelapp, cmd, env) {
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    const data = {
      appname : zelapp,
      cmd : JSON.parse(cmd),
      env : JSON.parse(env),
    };
    return Api().post('/zelapps/zelappexec', JSON.stringify(data), axiosConfig);
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
  getAppPirce(specifications) {
    return Api().post('/zelapps/calculateprice',
                      JSON.stringify(specifications));
  },
  getFolder(zelidauthHeader, folder) {
    return Api().get(`/zelapps/zelshare/getfolder/${folder}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  createFolder(zelidauthHeader, folder) {
    return Api().get(`/zelapps/zelshare/createfolder/${folder}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  getFile(zelidauthHeader, file) {
    return Api().get(`/zelapps/zelshare/getfile/${file}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  removeFile(zelidauthHeader, file) {
    return Api().get(`/zelapps/zelshare/removefile/${file}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  shareFile(zelidauthHeader, file) {
    return Api().get(`/zelapps/zelshare/sharefile/${file}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  unshareFile(zelidauthHeader, file) {
    return Api().get(`/zelapps/zelshare/unsharefile/${file}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  removeFolder(zelidauthHeader, folder) {
    return Api().get(`/zelapps/zelshare/removefolder/${folder}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  fileExists(zelidauthHeader, file) {
    return Api().get(`/zelapps/zelshare/fileexists/${file}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  storageStats(zelidauthHeader) {
    return Api().get('/zelapps/zelshare/stats', {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  renameFileFolder(zelidauthHeader, oldpath, newname) {
    return Api().get(`/zelapps/zelshare/rename/${oldpath}/${newname}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  justAPI() { return Api();},
};
