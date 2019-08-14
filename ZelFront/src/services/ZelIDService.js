import Api from '@/services/Api'
const qs = require('qs')

export default {
  loginPhrase() {
    return Api().get('/zelid/loginphrase')
  },

  verifyLogin(loginInfo) {
    return Api().post('/zelid/verifylogin', qs.stringify(loginInfo))
  },

  loggedUsers(zelidauthHeader) {
    return Api().get('/zelid/loggedusers', {
      headers: {
        zelidauth: zelidauthHeader
      }
    })
  },

  activeLoginPhrases(zelidauthHeader) {
    return Api().get('/zelid/activeloginphrases', {
      headers: {
        zelidauth: zelidauthHeader
      }
    })
  }
}
