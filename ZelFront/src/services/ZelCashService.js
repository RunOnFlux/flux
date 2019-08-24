import Api from '@/services/Api'

export default {
  getInfo() {
    return Api().get('/getinfo')
  },
  getZelNodeStatus() {
    return Api().get('/getzelnodestatus')
  }
}
