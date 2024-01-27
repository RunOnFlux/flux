import Api from '@/services/Api';

export default {
  getComponentStorageSpace(zelidauthHeader, appname, componentname, multiplier, decimal) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/getcomponentstoragespace/${appname}/${componentname}/${multiplier}/${decimal}`, axiosConfig);
  },
  getRemoteFileSize(zelidauthHeader, fileurl, multiplier, decimal) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/getremotefilesize/${fileurl}/${multiplier}/${decimal}`, axiosConfig);
  },
  getComponentPath(zelidauthHeader, appname, componentname) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/getcomponentpath/${appname}/${componentname}`, axiosConfig);
  },
};
