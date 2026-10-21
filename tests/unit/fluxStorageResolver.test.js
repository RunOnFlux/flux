const { expect } = require('chai');
const sinon = require('sinon');

const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const fluxCaching = require('../../ZelBack/src/services/utils/cacheManager');
const resolver = require('../../ZelBack/src/services/utils/fluxStorageResolver');

const ENV_LINK = 'https://storage.runonflux.io/v1/env/777210342462760';
const CMD_LINK = 'https://storage.runonflux.io/v1/cmd/918029783086795';
const CONTACTS_LINK = 'https://storage.runonflux.io/v1/contacts/1';
const PRESEARCH_LINK = 'https://storage.runonflux.io/v2/env/presearch';

describe('fluxStorageResolver tests', () => {
  let axiosGet;

  beforeEach(() => {
    fluxCaching.default.storagePayloadCache.clear();
    sinon.stub(fluxCommunicationMessagesSender, 'getFluxMessageSignature').resolves('signature');
    axiosGet = sinon.stub(serviceHelper, 'axiosGet');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('obtainPayloadFromStorage', () => {
    it('signs the request as this node and follows no redirect', async () => {
      axiosGet.resolves({ data: ['A=1'] });

      const payload = await resolver.obtainPayloadFromStorage(ENV_LINK, 'myapp');

      expect(payload).to.deep.equal(['A=1']);
      sinon.assert.calledOnce(axiosGet);
      const [url, options] = axiosGet.firstCall.args;
      expect(url).to.equal(ENV_LINK);
      expect(options.headers['flux-signature']).to.equal('signature');
      expect(options.headers['flux-app']).to.equal('myapp');
      expect(options.maxRedirects).to.equal(0);
    });

    // The request carries this node's signature, so the address is not the
    // specification author's to choose.
    it('refuses a link that does not address Flux storage, without a request', async () => {
      let error = null;
      await resolver.obtainPayloadFromStorage('http://169.254.169.254/latest/meta-data/', 'myapp').catch((e) => { error = e; });

      expect(error).to.be.an('error');
      expect(error.message).to.include('does not address Flux storage');
      sinon.assert.notCalled(axiosGet);
    });

    it('refuses to send a request it cannot sign', async () => {
      fluxCommunicationMessagesSender.getFluxMessageSignature.resolves(null);

      let error = null;
      await resolver.obtainPayloadFromStorage(ENV_LINK, 'myapp').catch((e) => { error = e; });

      expect(error).to.be.an('error');
      sinon.assert.notCalled(axiosGet);
    });
  });

  describe('resolveField', () => {
    it('answers null for a field without the marker', async () => {
      expect(await resolver.resolveField(['A=1'], 'F_S_ENV=', 'myapp')).to.equal(null);
      expect(await resolver.resolveField(undefined, 'F_S_ENV=', 'myapp')).to.equal(null);
      sinon.assert.notCalled(axiosGet);
    });

    it('reports a link off the storage host as an error and fetches nothing', async () => {
      const result = await resolver.resolveField(['F_S_ENV=https://example.com/v1/env/1'], 'F_S_ENV=', 'myapp');

      expect(result.status).to.equal('error');
      sinon.assert.notCalled(axiosGet);
    });

    // /v2/env/presearch is one link for every app using it, and storage answers
    // each app with its own keys: what it holds depends on flux-app as well.
    it('keeps what one app was given from another app with the same link', async () => {
      axiosGet.callsFake(async (url, options) => ({ data: [`PRIVATE_KEY=${options.headers['flux-app']}`] }));

      const first = await resolver.resolveField([`F_S_ENV=${PRESEARCH_LINK}`], 'F_S_ENV=', 'appone');
      const second = await resolver.resolveField([`F_S_ENV=${PRESEARCH_LINK}`], 'F_S_ENV=', 'apptwo');

      expect(first.values).to.deep.equal(['PRIVATE_KEY=appone']);
      expect(second.values).to.deep.equal(['PRIVATE_KEY=apptwo']);
      sinon.assert.calledTwice(axiosGet);
    });

    it('answers a second request for the same app and link from the cache', async () => {
      axiosGet.resolves({ data: ['A=1'] });

      await resolver.resolveField([`F_S_ENV=${ENV_LINK}`], 'F_S_ENV=', 'myapp');
      const again = await resolver.resolveField([`F_S_ENV=${ENV_LINK}`], 'F_S_ENV=', 'myapp');

      expect(again.status).to.equal('ok');
      sinon.assert.calledOnce(axiosGet);
    });

    it('reports a dead link as an error and asks again next time', async () => {
      axiosGet.rejects(new Error('down'));

      const failed = await resolver.resolveField([`F_S_ENV=${ENV_LINK}`], 'F_S_ENV=', 'myapp');
      axiosGet.resolves({ data: ['A=1'] });
      const recovered = await resolver.resolveField([`F_S_ENV=${ENV_LINK}`], 'F_S_ENV=', 'myapp');

      expect(failed.status).to.equal('error');
      expect(recovered.status).to.equal('ok');
      sinon.assert.calledTwice(axiosGet);
    });

    it('reports a payload that is not a list of strings as invalid or too large', async () => {
      axiosGet.resolves({ data: { not: 'a list' } });
      const invalid = await resolver.resolveField([`F_S_ENV=${ENV_LINK}`], 'F_S_ENV=', 'myapp');
      axiosGet.resolves({ data: [42] });
      const tooLarge = await resolver.resolveField([`F_S_CMD=${CMD_LINK}`], 'F_S_CMD=', 'myapp');

      expect(invalid.status).to.equal('error');
      expect(tooLarge.status).to.equal('too-large');
    });
  });

  describe('attachResolvedStorage', () => {
    it('resolves every component and the contacts into a clone, leaving the spec alone', async () => {
      axiosGet.callsFake(async (url) => ({ data: [`FROM=${url}`] }));
      const spec = {
        name: 'myapp',
        contacts: [`F_S_CONTACTS=${CONTACTS_LINK}`],
        compose: [
          { name: 'one', environmentParameters: [`F_S_ENV=${ENV_LINK}`], commands: [] },
          { name: 'two', environmentParameters: ['A=1'], commands: [`F_S_CMD=${CMD_LINK}`] },
        ],
      };
      const original = JSON.parse(JSON.stringify(spec));

      const resolved = await resolver.attachResolvedStorage(spec, 'myapp');

      expect(spec).to.deep.equal(original);
      expect(resolved.compose[0].environmentParametersResolved.values).to.deep.equal([`FROM=${ENV_LINK}`]);
      expect(resolved.compose[0]).to.not.have.property('commandsResolved');
      expect(resolved.compose[1].commandsResolved.values).to.deep.equal([`FROM=${CMD_LINK}`]);
      expect(resolved.compose[1]).to.not.have.property('environmentParametersResolved');
      expect(resolved.contactsResolved.values).to.deep.equal([`FROM=${CONTACTS_LINK}`]);
      axiosGet.getCalls().forEach((call) => expect(call.args[1].headers['flux-app']).to.equal('myapp'));
    });

    it('resolves a spec without compose at its top level', async () => {
      axiosGet.resolves({ data: ['A=1'] });

      const resolved = await resolver.attachResolvedStorage({ name: 'old', environmentParameters: [`F_S_ENV=${ENV_LINK}`] }, 'old');

      expect(resolved.environmentParametersResolved.status).to.equal('ok');
    });
  });
});
