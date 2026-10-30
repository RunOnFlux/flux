const { expect } = require('chai');
const natUpnp = require('@runonflux/nat-upnp');
const sinon = require('sinon');
const upnpMappingRecord = require('../../ZelBack/src/services/upnpMappingRecord');
const { client } = require('../../ZelBack/src/services/upnpRouter');

describe('upnpRouter tests', () => {
  describe('the router client keeps the mapping record', () => {
    let order;

    beforeEach(() => {
      order = [];
      sinon.stub(upnpMappingRecord, 'mapping').callsFake(async (port, protocol) => { order.push(`record ${port}/${protocol}`); });
      sinon.stub(upnpMappingRecord, 'removed').callsFake(async (port, protocol) => { order.push(`clear ${port}/${protocol}`); });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('records an add before it is sent', async () => {
      sinon.stub(natUpnp.Client.prototype, 'createMapping').callsFake(async () => { order.push('add'); });

      await client.createMapping({ public: 31000, private: 31000, protocol: 'UDP', description: 'Flux_App_web' });

      expect(order).to.deep.equal(['record 31000/UDP', 'add']);
      sinon.assert.calledOnceWithExactly(upnpMappingRecord.mapping, 31000, 'UDP', 'Flux_App_web');
    });

    it('records an add the router refuses, and leaves it for the start\'s cleanup', async () => {
      sinon.stub(natUpnp.Client.prototype, 'createMapping').rejects(new natUpnp.UpnpError(718, 'ConflictInMappingEntry', 'AddPortMapping'));

      const error = await client.createMapping({ public: { port: 31000 }, description: 'Flux_App_web' }).catch((e) => e);

      expect(error.code).to.equal(718);
      expect(order).to.deep.equal(['record 31000/TCP']);
    });

    it('ends the record of a mapping the router removed', async () => {
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').callsFake(async () => { order.push('remove'); });

      await client.removeMapping({ public: { host: '', port: 31000 }, protocol: 'UDP' });

      expect(order).to.deep.equal(['remove', 'clear 31000/UDP']);
    });

    [
      [714, 'NoSuchEntryInArray', 'holds no such entry'],
      [606, 'Action not authorized', 'refuses to remove a mapping that is not this node\'s'],
    ].forEach(([code, name, what]) => {
      it(`ends the record when the router ${what}, and still throws`, async () => {
        sinon.stub(natUpnp.Client.prototype, 'removeMapping').rejects(new natUpnp.UpnpError(code, name, 'DeletePortMapping'));

        const error = await client.removeMapping({ public: 31000 }).catch((e) => e);

        expect(error.code).to.equal(code);
        expect(order).to.deep.equal(['clear 31000/TCP']);
      });
    });

    it('keeps the record when the router refuses for a reason of its own', async () => {
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').rejects(new natUpnp.UpnpError(501, 'ActionFailed', 'DeletePortMapping'));

      const error = await client.removeMapping({ public: 31000 }).catch((e) => e);

      expect(error.code).to.equal(501);
      expect(order).to.deep.equal([]);
    });

    it('keeps the record when the router does not answer', async () => {
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').rejects(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

      const error = await client.removeMapping({ public: 31000 }).catch((e) => e);

      expect(error.message).to.equal('socket hang up');
      expect(order).to.deep.equal([]);
    });
  });
});
