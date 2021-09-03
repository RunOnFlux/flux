import Api from '@/services/Api'

const qs = require('qs')

export default {
  loginPhrase() {
    return Api().get('/id/loginphrase')
  },

  emergencyLoginPhrase() {
    return Api().get('/id/emergencyphrase')
  },

  verifyLogin(loginInfo) {
    return Api().post('/id/verifylogin', qs.stringify(loginInfo))
  },

  loggedSessions(zelidauthHeader) {
    return Api().get(`/id/loggedsessions?timestamp=${new Date().getTime()}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    })
  },

  loggedUsers(zelidauthHeader) {
    return Api().get(`/id/loggedusers?timestamp=${new Date().getTime()}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    })
  },

  activeLoginPhrases(zelidauthHeader) {
    return Api().get('/id/activeloginphrases', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    })
  },

  logoutCurrentSession(zelidauthHeader) {
    return Api().get('/id/logoutcurrentsession', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    })
  },

  logoutSpecificSession(zelidauthHeader, loginPhrase) {
    const data = {
      loginPhrase,
    }
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    }
    return Api().post('/id/logoutspecificsession', qs.stringify(data), axiosConfig)
  },

  logoutAllSessions(zelidauthHeader) {
    return Api().get('/id/logoutallsessions', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    })
  },

  logoutAllUsers(zelidauthHeader) {
    return Api().get('/id/logoutallusers', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    })
  },
  checkUserLogged(zelid, signature) {
    const data = {
      zelid,
      signature,
    }
    return Api().post('/id/checkprivilege', qs.stringify(data))
  },
}
