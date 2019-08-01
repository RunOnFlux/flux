import Api from '@/services/Api'

export default {
  fetchDefault() {
    return Api().get('/')
  }
}
