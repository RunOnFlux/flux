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
  getRemoteFileSize(zelidauthHeader, fileurl, multiplier, decimal, number, appname) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/getremotefilesize/${fileurl}/${multiplier}/${decimal}/${number}/${appname}`, axiosConfig);
  },
  getBackupList(zelidauthHeader, path, multiplier, decimal, number, appname) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/getlocalbackuplist/${path}/${multiplier}/${decimal}/${number}/${appname}`, axiosConfig);
  },
  removeBackupFile(zelidauthHeader, filepath, appname) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/removebackupfile/${filepath}/${appname}`, axiosConfig);
  },
  justAPI() {
    return Api();
  },
};
