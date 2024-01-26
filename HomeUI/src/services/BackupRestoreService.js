import Api from '@/services/Api';

export default {
  getAvailableSpaceOfApp(zelidauthHeader, appname, componentname) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().get(`/backup/getavailablespaceofapp/${appname}/${componentname}`, axiosConfig);
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
