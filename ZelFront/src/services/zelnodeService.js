import Api from '@/services/Api'

export default {
  updateFlux(zelidauthHeader) {
    return Api().get('/zelnode/updateflux', {
      headers: {
        zelidauth: zelidauthHeader
      }
    })
  }
}
