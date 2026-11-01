const { expect } = require('chai');
const natUpnp = require('@runonflux/nat-upnp');
const sinon = require('sinon');
const upnpMappingRecord = require('../../ZelBack/src/services/upnpMappingRecord');
const { client, mayStillBeThisNodes } = require('../../ZelBack/src/services/upnpRouter');

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
      sinon.assert.calledOnceWithExactly(upnpMappingRecord.mapping, 31000, 'UDP', 'Flux_App_web', 0);
    });

    it('records the lease an add asks for', async () => {
      sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves();

      await client.createMapping({ public: 31000, private: 31000, protocol: 'TCP', ttl: 2100, description: 'Flux_App_web' });

      sinon.assert.calledOnceWithExactly(upnpMappingRecord.mapping, 31000, 'TCP', 'Flux_App_web', 2100);
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
  // Whether a mapping this node made may still be its own: its lease, then the
  // router's answer, which can only end it.
  describe('mayStillBeThisNodes', () => {
    const NOW = Date.parse('2026-10-31T12:00:00Z');
    const leased = (secondsAgo, lease = 2100) => ({ at: new Date(NOW - secondsAgo * 1000), lease });
    const permanent = { at: new Date(NOW - 86400 * 1000), lease: 0 };
    const answer = (host, local) => ({
      public: { host: '', port: 31000 }, private: { host, port: 31000 }, protocol: 'tcp', enabled: true, description: 'Flux_App_web', ttl: 0, local,
    });
    let routerClient;
    const ask = (added) => mayStillBeThisNodes(routerClient, 31000, 'TCP', added, NOW);

    beforeEach(() => {
      routerClient = { getMapping: sinon.stub() };
    });

    it('ends a leased mapping once its lease has run out, asking the router nothing', async () => {
      expect(await ask(leased(2100))).to.equal(false);
      sinon.assert.notCalled(routerClient.getMapping);
    });

    [
      ['a leased mapping inside its lease', leased(2099)],
      ['a permanent mapping', permanent],
      ['a mapping with no add on record', null],
    ].forEach(([what, added]) => {
      it(`keeps ${what} the router maps to this node`, async () => {
        routerClient.getMapping.resolves(answer('192.168.1.10', true));

        expect(await ask(added)).to.equal(true);
        sinon.assert.calledOnceWithExactly(routerClient.getMapping, { public: 31000, protocol: 'TCP' });
      });

      it(`ends ${what} the router maps to another machine`, async () => {
        routerClient.getMapping.resolves(answer('192.168.1.20', false));

        expect(await ask(added)).to.equal(false);
      });

      it(`ends ${what} the router holds no entry for`, async () => {
        routerClient.getMapping.resolves(null);

        expect(await ask(added)).to.equal(false);
      });

      it(`keeps ${what} the router answers with an empty entry`, async () => {
        routerClient.getMapping.resolves(answer('', false));

        expect(await ask(added)).to.equal(true);
      });

      it(`keeps ${what} the router answers with a fault or not at all`, async () => {
        routerClient.getMapping.rejects(new natUpnp.UpnpError(501, 'ActionFailed', 'GetSpecificPortMappingEntry'));
        expect(await ask(added)).to.equal(true);
        routerClient.getMapping.rejects(new Error('timeout of 10000ms exceeded'));
        expect(await ask(added)).to.equal(true);
      });
    });
  });
});
