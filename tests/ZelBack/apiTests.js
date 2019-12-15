const request = require('supertest');
const config = require('config');
const app = require('../../ZelBack/src/lib/server.js');
const log = require('../../ZelBack/src/lib/log');

const server = app.listen(config.server.apiport, () => {
  log.info(`ZelBack listening on port ${config.server.apiport}!`);
});

describe('loading express', function () {
  after(function (done) {
    server.close(done);
  }); 
  it('/zelflux/version', function testSlash(done) {
    request(server)
      .get('/zelflux/version')
      .expect(200, done);
  });
  it('/zelid/loginphrase', function testPath(done) {
    request(server)
      .get('/foo/bar')
      .expect(404, done);
  });
});