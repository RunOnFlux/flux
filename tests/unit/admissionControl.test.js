const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
const { expect } = chai;
const admissionControl = require('../../ZelBack/src/services/utils/admissionControl');
const operationRegistry = require('../../ZelBack/src/services/utils/operationRegistry');

describe('admissionControl tests', () => {
  const footprint = (cpu) => async () => ({ cpu, ram: 0, hdd: 0 });
  // A node with room for one app. The check reads what is reserved, then takes a
  // turn of the event loop before it answers, as a check reading the database does.
  const roomForOne = (appName) => async () => {
    const others = [...admissionControl.reserved().keys()].filter((name) => name !== appName);
    await new Promise((resolve) => { setImmediate(resolve); });
    if (others.length) throw new Error('Insufficient CPU power on Flux Node to spawn an application');
  };

  afterEach(() => {
    admissionControl.clear();
    operationRegistry.clear();
  });

  it('admits one app at a time, so a check sees every reservation made before it', async () => {
    operationRegistry.acquire('app1', 'install', 'test');
    operationRegistry.acquire('app2', 'install', 'test');

    const results = await Promise.allSettled([
      admissionControl.admit('app1', roomForOne('app1'), footprint(1)),
      admissionControl.admit('app2', roomForOne('app2'), footprint(1)),
    ]);

    expect(results.map((result) => result.status)).to.deep.equal(['fulfilled', 'rejected']);
    expect([...admissionControl.reserved().keys()]).to.deep.equal(['app1']);
  });

  it('reserves nothing for an app its check refuses', async () => {
    operationRegistry.acquire('app1', 'install', 'test');

    await expect(admissionControl.admit('app1', async () => { throw new Error('no room'); }, footprint(1))).to.be.rejectedWith('no room');

    expect(admissionControl.reserved().size).to.equal(0);
  });

  it('reserves only for an operation holding the app', async () => {
    await admissionControl.admit('app1', async () => {}, footprint(1));

    expect(admissionControl.reserved().size).to.equal(0);
  });

  it('keeps a reservation until the operation holding the app ends', async () => {
    const token = operationRegistry.acquire('app1', 'redeploy', 'test');
    await admissionControl.admit('app1', async () => {}, footprint(2));

    expect(admissionControl.reserved().get('app1')).to.deep.equal({ cpu: 2, ram: 0, hdd: 0 });
    operationRegistry.release('app1', token);
    expect(admissionControl.reserved().has('app1')).to.equal(false);
  });
});
