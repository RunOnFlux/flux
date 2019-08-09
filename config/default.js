module.exports = {
  server: {
    localport: 16127,
    zelnodeport: 16128
  },
  database: {
    url: '127.0.0.1',
    port: 27017,
    local: {
      database: 'zelnodelocal',
      collections: {
        loggedUsers: 'loggedusers',
        activeLoginPhrases: 'activeloginphrases'
      }
    },
    global: {
      database: 'zelnodeglobal',
      collections: {
        zelid: 'zelid'
      }
    }
  }
}
