import Api from '@/services/Api';

export default {
  getVolumeDataOfComponent(zelidauthHeader, appname, componentname, multiplier, decimal, fields) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/getvolumedataofcomponent/${appname}/${componentname}/${multiplier}/${decimal}/${fields}`, axiosConfig);
  },
  getRemoteFileSize(zelidauthHeader, fileurl, multiplier, decimal) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/getremotefilesize/${fileurl}/${multiplier}/${decimal}`, axiosConfig);
  },
  getBackupList(zelidauthHeader, path, multiplier, decimal) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/getbackuplist/${path}/${multiplier}/${decimal}`, axiosConfig);
  },
  removeBackupFile(zelidauthHeader, filepath) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/removebackupfile/${filepath}`, axiosConfig);
  },
  getRemoteFile(zelidauthHeader, data) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().post('/backup/getremotefile', JSON.stringify(data), axiosConfig);
  },
  justAPI() {
    return Api();
  },
};
