globalThis.userconfig = require('../../config/userconfig');

process.env.NODE_CONFIG_DIR = `${process.cwd()}/ZelBack/config/`;

const request = require('supertest');
const config = require('config');
const chai = require('chai');

const { FluxServer } = require('../../ZelBack/src/lib/fluxServer');
const log = require('../../ZelBack/src/lib/log');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const syncthingService = require('../../ZelBack/src/services/syncthingService');

const packageJson = require('../../package.json');

const { expect } = chai;
const { version } = packageJson;

const cert = `-----BEGIN CERTIFICATE-----
MIIDSTCCAjGgAwIBAgIUY25XIwiQtHE3DM+Dk1wIwGMHZnUwDQYJKoZIhvcNAQEL
BQAwNDEeMBwGA1UEAwwVc2VsZi5hcGkucnVub25mbHV4LmlvMRIwEAYDVQQKDAlS
dW5PbkZsdXgwHhcNMjQwNzA4MDYzNjAwWhcNMzQwNzA2MDYzNjAwWjA0MR4wHAYD
VQQDDBVzZWxmLmFwaS5ydW5vbmZsdXguaW8xEjAQBgNVBAoMCVJ1bk9uRmx1eDCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAK40LBxi8UO30RLNf+kB88CF
f5pssa4XODos9ORQc7TXuI9iozAi7zInkLo8Kbl00qCGf3SfKGEampDUAsBVY8Kb
kWNnqlM0f98Plb4qIGdVexG7f7JVS/fbkeb8h8Af7NHiWIYHxH+wPSaJw4rgfHk+
2o2kx7vmOBMShacspdxh9MNriKGgnnv/VbpFh7A4nzpNIUMxHoXnuINKKhNmokRa
wFUfl4awDsNeAFDhpCOa9JzZB1XeAhBfwkv3QmI59XuJ27UFJkwPU/TDdFzs3fN3
CIQH9Ziw7Af/XNPLN4VqQ/Vj3MUGrPAxxqfk/RBKvURXZ/oYDzw0ktwCGe24NO0C
AwEAAaNTMFEwHQYDVR0OBBYEFIDILK9REIMe0jVJyZlqIxkKXghtMB8GA1UdIwQY
MBaAFIDILK9REIMe0jVJyZlqIxkKXghtMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBAGN8GCY2bTFcXcSZPDlUVgjtFRekz40QlwJ8cDUn9lFrTiR1
+2sJWpe7o7N9AFPmRi/0hIQ7qn6bF2E/yZ7AMK4ocmymrdsuCS2vbfDBo6eqMoBP
gy/HJmCI3ioDZIhXF5ygKB9PAmefE/Je1JCmWPvxpAKEOTOa7oEvvhNzH7AgBXPT
QI9SBFisH00R3QbuVOcKPSy6KwhR58h894JQ1Royr0Hy4Zi9T2TJMMoTo2K4d4mX
KmgRbMEkA0r4RXu7shQAkDoijrnJfxviEpVnEITlVe4Y0aLpACbv2QQj5doewx7L
SGxjaxDYEz+40hdVsz3DjGifABhg0F/hbEnl5X4=
-----END CERTIFICATE-----`;

const key = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCuNCwcYvFDt9ES
zX/pAfPAhX+abLGuFzg6LPTkUHO017iPYqMwIu8yJ5C6PCm5dNKghn90nyhhGpqQ
1ALAVWPCm5FjZ6pTNH/fD5W+KiBnVXsRu3+yVUv325Hm/IfAH+zR4liGB8R/sD0m
icOK4Hx5PtqNpMe75jgTEoWnLKXcYfTDa4ihoJ57/1W6RYewOJ86TSFDMR6F57iD
SioTZqJEWsBVH5eGsA7DXgBQ4aQjmvSc2QdV3gIQX8JL90JiOfV7idu1BSZMD1P0
w3Rc7N3zdwiEB/WYsOwH/1zTyzeFakP1Y9zFBqzwMcan5P0QSr1EV2f6GA88NJLc
AhntuDTtAgMBAAECggEADiPG9tDjI2t+qWeLu9aAOf68AkVTUL2qvzIZ+JQ9KA8g
eGb5tvUG9Eu42Bz9CAQe+o+gNc+bX/JgXGQRCxqDO+8TqH1oGlPXEzx5G5PgyHJs
SF6vOULqJSap25Vg0Wvl9Y1JQSvNO84K0J97A0FAaTj8VWXsHmjL4WRt+8lIdzBL
/C6JbxPDANfBHj0UWEJuGAOkT0b+UkKj+FdEy7UjHP9K38IxCFEt7OoVCtIej2CN
UpoknNMf6Id+OgO1KyUsomUgjPEbkKyiWHuKPQ76fvFalJDLq5zGhT7zLFP0udoX
vyLoJpwxTJ8Lc2LqbPK+P9Upg4tROp06FQQTaslXEwKBgQDV/eZPmXVdnJ5S0AxU
LxEG96aeqpsDrby3UIOiPCTF9kWkFWD+Om9sp5DHnkgtaQg2nKeRIbFtkF17IugA
sL+SBy7cx+KxwcEJyRECEHiYL5kehroR9zBBdkGFyl4U7uQms8q4X0XcFSxpLQY7
Ikg0dNPwcDklCl1sAlFCbNpADwKBgQDQZrzNJ5XGGeLm9GqY6UiXZZPk8WkB1NM8
7BGTIJQjeaPUqS7P2NCcbORAVIH15hjCnQJ1H19v0k6dncP03nt7XoSsrXtdkjZ3
i/ns3ipsH9czEiX1Ujg1PW2k1EpQb6XS5HH6k4DcwFffJ9ZSGBxqgyry319lG9l5
80Lztg5/QwKBgQCtTCtB91MW9ok5I4d4fY1aiSCEikFzXzXfdvLDZdWaA/EuCqo7
+HLYGXOkVUi6jb67C26gmBqqUimCWShttrXNusd2wOGTdwevtwdxFomzJYjpMc5q
UjbgLLavdM1wQm698QiQ+4cFzpfirTXImeDDqoEgzKFan+Q8XjwUgTbWfQKBgHaQ
3P3DdbzdYXCQwkz4/GnWSsxIZLu7/+p7TIxuTpnYTNNi5dUuv5EfisTmz4G9RX0D
ozBLhxqxhjS6W5BnO822urkbgkJ8OyzMoIaY533Yp7DQtHPcMUppBoZumVEmFCvl
+MrdPMVbUSMPISpXuWMH+VlwqG935sUxF3hcrebNAoGAJBMk9xMIdL58F4dvsxeW
Xg0sKrSc7QRzq8r83VCrnAxiYubL0IpQhHuoUCu+b8ADQGS108HV/TUX+q0H2T/s
fgKMPbl6D7mGGtyCwv542eDhS+aVa4jWugZ4yty7RufJMN8nM6te1oEHhXB6tczZ
I4y4ld7rRSBwWhknpNZLacQ=
-----END PRIVATE KEY-----`;

const fluxServerHttp = new FluxServer();
const fluxServerHttps = new FluxServer({
  mode: 'https', key, cert, expressApp: fluxServerHttp.app,
});

const { server: serverHttp } = fluxServerHttp;
const { server: serverHttps } = fluxServerHttps;

describe('loading express', () => {
  after((done) => {
    fluxServerHttp.close(done);
    setTimeout(() => {
      process.exit();
    }, 10000);
  });
  before(async () => {
    await dbHelper.initiateDB();
    await fluxServerHttp.listen(config.server.apiport);
    log.info(`Flux listening on port ${config.server.apiport}!`);
  });
  it('http /flux/version', (done) => {
    request(serverHttp)
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
  it('https /flux/version', (done) => {
    request(serverHttps)
      .get('/flux/version')
      .trustLocalhost(true)
      .expect(200)
      .end((err, res) => {
        if (err) {
          return done(err);
        }
        expect(JSON.parse(res.text).data).to.be.equal(version);
        return done();
      });
  });
  it('http non-existing-path', (done) => {
    request(serverHttp)
      .get('/foo/bar')
      .expect(404, done);
  });
  it('https non-existing-path', (done) => {
    request(serverHttps)
      .get('/foo/bar')
      .trustLocalhost(true)
      .expect(404, done);
  });
  it('http /id/loginphrase', (done) => {
    syncthingService.setSyncthingRunningState(true);
    request(serverHttp)
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
  it('https /id/loginphrase', (done) => {
    syncthingService.setSyncthingRunningState(true);
    request(serverHttps)
      .get('/id/loginphrase')
      .trustLocalhost(true)
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
