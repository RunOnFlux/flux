import Api from '@/services/Api';

export default {
  listRunningApps() {
    return Api().get('/apps/listrunningapps');
  },
  listAllApps() {
    return Api().get('/apps/listallapps');
  },
  installedApps() {
    return Api().get('/apps/installedapps');
  },
  availableApps() {
    return Api().get('/apps/availableapps');
  },
  stopZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appstop/${zelapp}`, axiosConfig);
  },
  startZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appstart/${zelapp}`, axiosConfig);
  },
  pauseZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/apppause/${zelapp}`, axiosConfig);
  },
  unpauseZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appunpause/${zelapp}`, axiosConfig);
  },
  restartZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/apprestart/${zelapp}`, axiosConfig);
  },
  removeZelApp(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
      onDownloadProgress(progressEvent) {
        console.log(progressEvent);
      },
    };
    return Api().get(`/apps/appremove/${zelapp}`, axiosConfig);
  },
  registerZelApp(zelidauthHeader, data) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().post('/apps/appregister', JSON.stringify(data), axiosConfig);
  },
  updateZelApp(zelidauthHeader, data) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().post('/apps/appupdate', JSON.stringify(data), axiosConfig);
  },
  checkCommunication() {
    return Api().get('/flux/checkcommunication');
  },
  checkDockerExistance(zelidauthHeader, data) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().post('/apps/checkdockerexistance', JSON.stringify(data), axiosConfig);
  },
  zelappsRegInformation() {
    return Api().get('/apps/registrationinformation');
  },
  getZelAppLocation(name) {
    return Api().get(`/apps/location/${name}`);
  },
  globalZelAppSpecifications() {
    return Api().get('/apps/globalappsspecifications');
  },
  getInstalledZelAppSpecifics(name) {
    return Api().get(`/apps/installedapps/${name}`);
  },
  getZelAppSpecifics(name) {
    return Api().get(`/apps/appspecifications/${name}`);
  },
  getZelAppOwner(name) {
    return Api().get(`/apps/appowner/${name}`);
  },
  getZelAppLogsTail(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/applog/${zelapp}/100`, axiosConfig);
  },
  getZelAppTop(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/apptop/${zelapp}`, axiosConfig);
  },
  getZelAppInspect(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appinspect/${zelapp}`, axiosConfig);
  },
  getZelAppStats(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appstats/${zelapp}`, axiosConfig);
  },
  getZelAppChanges(zelidauthHeader, zelapp) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appchanges/${zelapp}`, axiosConfig);
  },
  getZelAppExec(zelidauthHeader, zelapp, cmd, env) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    const data = {
      appname: zelapp,
      cmd: JSON.parse(cmd),
      env: JSON.parse(env),
    };
    return Api().post('/apps/appexec', JSON.stringify(data), axiosConfig);
  },
  reindexGlobalApps(zelidauthHeader) {
    return Api().get('/apps/reindexglobalappsinformation', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  reindexLocations(zelidauthHeader) {
    return Api().get('/apps/reindexglobalappslocation', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  rescanGlobalApps(zelidauthHeader, height, removelastinformation) {
    return Api().get(`/apps/rescanglobalappsinformation/${height}/${removelastinformation}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  getAppPirce(specifications) {
    return Api().post('/apps/calculateprice', JSON.stringify(specifications));
  },
  getFolder(zelidauthHeader, folder) {
    return Api().get(`/apps/fluxshare/getfolder/${folder}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  createFolder(zelidauthHeader, folder) {
    return Api().get(`/apps/fluxshare/createfolder/${folder}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  getFile(zelidauthHeader, file) {
    return Api().get(`/apps/fluxshare/getfile/${file}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  removeFile(zelidauthHeader, file) {
    return Api().get(`/apps/fluxshare/removefile/${file}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  shareFile(zelidauthHeader, file) {
    return Api().get(`/apps/fluxshare/sharefile/${file}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  unshareFile(zelidauthHeader, file) {
    return Api().get(`/apps/fluxshare/unsharefile/${file}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  removeFolder(zelidauthHeader, folder) {
    return Api().get(`/apps/fluxshare/removefolder/${folder}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  fileExists(zelidauthHeader, file) {
    return Api().get(`/apps/fluxshare/fileexists/${file}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  storageStats(zelidauthHeader) {
    return Api().get('/apps/fluxshare/stats', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  renameFileFolder(zelidauthHeader, oldpath, newname) {
    return Api().get(`/apps/fluxshare/rename/${oldpath}/${newname}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  justAPI() {
    return Api();
  },
};
