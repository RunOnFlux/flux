import Api from '@/services/Api'
const qs = require('qs')

export default {
  loginPhrase() {
    return Api().get('/zelid/loginphrase')
  },

  verifyLogin(loginInfo) {
    return Api().post('/zelid/verifylogin', qs.stringify(loginInfo))
  }
}
