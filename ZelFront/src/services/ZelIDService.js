import Api from '@/services/Api';

const qs = require('qs');

export default {
  loginPhrase() {
    return Api().get('/zelid/loginphrase');
  },

  emergencyLoginPhrase() {
    return Api().get('/zelid/emergencyphrase');
  },

  verifyLogin(loginInfo) {
    return Api().post('/zelid/verifylogin', qs.stringify(loginInfo));
  },

  loggedSessions(zelidauthHeader) {
    return Api().get('/zelid/loggedsessions', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },

  loggedUsers(zelidauthHeader) {
    return Api().get('/zelid/loggedusers', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },

  activeLoginPhrases(zelidauthHeader) {
    return Api().get('/zelid/activeloginphrases', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },

  logoutCurrentSession(zelidauthHeader) {
    return Api().get('/zelid/logoutcurrentsession', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },

  logoutSpecificSession(zelidauthHeader, loginPhrase) {
    const data = {
      loginPhrase,
    };
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().post(
      '/zelid/logoutspecificsession',
      qs.stringify(data),
      axiosConfig
    );
  },

  logoutAllSessions(zelidauthHeader) {
    return Api().get('/zelid/logoutallsessions', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },

  logoutAllUsers(zelidauthHeader) {
    return Api().get('/zelid/logoutallusers', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  checkUserLogged(zelid, signature) {
    const data = {
      zelid,
      signature,
    };
    return Api().post('/zelid/checkprivilege', qs.stringify(data));
  },
};
