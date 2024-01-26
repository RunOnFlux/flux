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
};
