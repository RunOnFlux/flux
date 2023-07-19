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
  getEnterpriseNodes() {
    return Api().get('/apps/enterprisenodes');
  },
  stopApp(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appstop/${app}`, axiosConfig);
  },
  startApp(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appstart/${app}`, axiosConfig);
  },
  pauseApp(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/apppause/${app}`, axiosConfig);
  },
  unpauseApp(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appunpause/${app}`, axiosConfig);
  },
  restartApp(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/apprestart/${app}`, axiosConfig);
  },
  removeApp(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
      onDownloadProgress(progressEvent) {
        console.log(progressEvent);
      },
    };
    return Api().get(`/apps/appremove/${app}`, axiosConfig);
  },
  registerApp(zelidauthHeader, data) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().post('/apps/appregister', JSON.stringify(data), axiosConfig);
  },
  updateApp(zelidauthHeader, data) {
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
  appsRegInformation() {
    return Api().get('/apps/registrationinformation');
  },
  appsDeploymentInformation() {
    return Api().get('/apps/deploymentinformation');
  },
  getAppLocation(name) {
    return Api().get(`/apps/location/${name}`);
  },
  globalAppSpecifications() {
    return Api().get('/apps/globalappsspecifications');
  },
  getInstalledAppSpecifics(name) {
    return Api().get(`/apps/installedapps/${name}`);
  },
  getAppSpecifics(name) {
    return Api().get(`/apps/appspecifications/${name}`);
  },
  getAppOwner(name) {
    return Api().get(`/apps/appowner/${name}`);
  },
  getAppLogsTail(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/applog/${app}/100`, axiosConfig);
  },
  getAppTop(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/apptop/${app}`, axiosConfig);
  },
  getAppInspect(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appinspect/${app}`, axiosConfig);
  },
  getAppStats(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appstats/${app}`, axiosConfig);
  },
  getAppChanges(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appchanges/${app}`, axiosConfig);
  },
  getAppExec(zelidauthHeader, app, cmd, env) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    const data = {
      appname: app,
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
  appPrice(data) {
    return Api().post('/apps/calculateprice', JSON.stringify(data));
  },
  appRegistrationVerificaiton(data) {
    return Api().post('/apps/verifyappregistrationspecifications', JSON.stringify(data));
  },
  appUpdateVerification(data) {
    return Api().post('/apps/verifyappupdatespecifications', JSON.stringify(data));
  },
  getAppMonitoring(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/apps/appmonitor/${app}`, axiosConfig);
  },
  startAppMonitoring(zelidauthHeader, app) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    if (app) {
      return Api().get(`/apps/startmonitoring/${app}`, axiosConfig);
    }
    return Api().get('/apps/startmonitoring', axiosConfig);
  },
  stopAppMonitoring(zelidauthHeader, app, deleteData) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    if (app && deleteData) { // stop monitoring of specific app or app component and delete data
      return Api().get(`/apps/stopmonitoring/${app}/${deleteData}`, axiosConfig);
    }
    if (app) { // stop monitoring of specific app or app component
      return Api().get(`/apps/stopmonitoring/${app}`, axiosConfig);
    }
    if (deleteData) { // stop monitoring of all apps and delete data
      return Api().get(`/apps/stopmonitoring?deletedata=${deleteData}`, axiosConfig);
    }
    // stop monitoring of all apps
    return Api().get('/apps/stopmonitoring', axiosConfig);
  },
  justAPI() {
    return Api();
  },
};
