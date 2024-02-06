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
  getRemoteFileSize(zelidauthHeader, fileurl, multiplier, decimal, number) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/getremotefilesize/${fileurl}/${multiplier}/${decimal}/${number}`, axiosConfig);
  },
  getBackupList(zelidauthHeader, path, multiplier, decimal, number) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/getlocalbackuplist/${path}/${multiplier}/${decimal}/${number}`, axiosConfig);
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
        'Content-Type': 'application/json',
        zelidauth: zelidauthHeader,
      },
    };
    return Api().post('/backup/getremotefile', JSON.stringify(data), axiosConfig);
  },
  justAPI() {
    return Api();
  },
};
