process.env.NODE_CONFIG_DIR = `${process.cwd()}/ZelBack/config/`;
import request from 'supertest';
import { config } from '../../config/default.js';
import chai from 'chai';
import app from '../../ZelBack/src/lib/server.js';
app.default;
import log from '../../ZelBack/src/lib/log.js';
log.default;
import dbHelper from '../../ZelBack/src/services/dbHelper.js';
dbHelper.default;

import { createRequire } from "module"; // Bring in the ability to create the 'require' method
const require = createRequire(import.meta.url); // construct the require method
const packageJson = require('../../package.json');

const { expect } = chai;
const { version } = packageJson;

const server = app.listen(config.server.apiport, () => {
  log.info(`Flux listening on port ${config.server.apiport}!`);
});

describe('loading express', () => {
  after((done) => {
    server.close(done);
    setTimeout(() => {
      process.exit();
    }, 10000);
  });
  before(async () => {
    await dbHelper.initiateDB();
  });
  it('/flux/version', (done) => {
    request(server)
      .get('/flux/version')
      .expect(200)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        expect(JSON.parse(res.text).data).to.be.equal(version);
        return done();
      });
  });
  it('non-existing-path', (done) => {
    request(server)
      .get('/foo/bar')
      .expect(404, done);
  });
  it('/id/loginphrase', (done) => {
    request(server)
      .get('/id/loginphrase')
      .expect(200)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        expect(JSON.parse(res.text).status).to.be.equal('success');
        expect(JSON.parse(res.text).data.charAt(0)).to.be.equal('1');
        return done();
      });
  });
});
