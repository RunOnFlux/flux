const { expect } = require('chai');
const portClaims = require('../../ZelBack/src/services/appNetwork/portClaims');

const { ClaimKind, InstallStep } = portClaims;

// Resolves on the next turn of the event loop: anything a release woke has run.
const settle = () => new Promise((resolve) => { setImmediate(resolve); });

describe('portClaims', () => {
  afterEach(() => {
    expect(portClaims.claimedPorts(), 'a case left a claim behind').to.deep.equal([]);
    expect(portClaims.waiting(), 'a case left a caller waiting').to.equal(0);
  });

  describe('claim and release', () => {
    it('claims every port and names who holds them', () => {
      const held = portClaims.claim([31001, 31002], ClaimKind.INSTALL, 'appone');

      expect(held).to.include({ kind: ClaimKind.INSTALL, owner: 'appone' });
      expect(portClaims.claimedPorts()).to.have.members([31001, 31002]);
      expect(portClaims.holderOf([31002])).to.equal(held);

      portClaims.release(held);
    });

    it('claims none of the ports when one is already held', () => {
      const first = portClaims.claim([31002], ClaimKind.CHECK, 'availabilityCheck');

      expect(portClaims.claim([31001, 31002], ClaimKind.INSTALL, 'appone')).to.equal(null);
      expect(portClaims.claimedPorts()).to.deep.equal([31002]);

      portClaims.release(first);
    });

    it('reads a port given as a string as the same port', () => {
      const held = portClaims.claim(['31001'], ClaimKind.INSTALL, 'appone');

      expect(portClaims.claim([31001], ClaimKind.CHECK, 'availabilityCheck')).to.equal(null);
      expect(portClaims.holderOf(['31001'])).to.equal(held);

      portClaims.release(held);
    });

    it('holds a port named twice once, and frees it on one release', () => {
      const held = portClaims.claim([31001, 31001], ClaimKind.INSTALL, 'appone');

      expect(held.ports).to.deep.equal([31001]);

      portClaims.release(held);
    });

    it('claims nothing for an app with no ports, and refuses nobody', () => {
      const held = portClaims.claim([], ClaimKind.INSTALL, 'appone');

      expect(held.ports).to.deep.equal([]);
      expect(portClaims.claimedPorts()).to.deep.equal([]);

      portClaims.release(held);
    });

    it('frees exactly the released claim\'s ports', () => {
      const one = portClaims.claim([31001], ClaimKind.INSTALL, 'appone');
      const two = portClaims.claim([31002], ClaimKind.CHECK, 'availabilityCheck');

      portClaims.release(one);

      expect(portClaims.claimedPorts()).to.deep.equal([31002]);
      portClaims.release(two);
    });

    it('does nothing on a second release of the same claim, or a release of null', () => {
      const first = portClaims.claim([31001], ClaimKind.INSTALL, 'appone');
      portClaims.release(first);
      const second = portClaims.claim([31001], ClaimKind.INSTALL, 'apptwo');

      portClaims.release(first);
      portClaims.release(null);

      expect(portClaims.holderOf([31001])).to.equal(second);
      portClaims.release(second);
    });
  });

  describe('whenFree', () => {
    it('resolves at once for ports nobody holds', async () => {
      await portClaims.whenFree([31001]);
    });

    it('resolves once the last claim on its ports is released, and not before', async () => {
      const one = portClaims.claim([31001], ClaimKind.CHECK, 'availabilityCheck');
      const two = portClaims.claim([31002], ClaimKind.INSTALL, 'apptwo');
      let freed = false;
      const waiting = portClaims.whenFree([31001, 31002]).then(() => { freed = true; });

      portClaims.release(one);
      await settle();
      expect(freed, 'freed while 31002 was held').to.equal(false);
      expect(portClaims.waiting()).to.equal(1);

      portClaims.release(two);
      await waiting;
      expect(freed).to.equal(true);
    });
  });

  describe('claimForInstall', () => {
    it('claims free ports at once', async () => {
      const { claim, heldBy } = await portClaims.claimForInstall([31001], 'appone', InstallStep.INSTALL);

      expect(heldBy).to.equal(null);
      expect(claim).to.include({ kind: ClaimKind.INSTALL, owner: 'appone' });
      portClaims.release(claim);
    });

    it('waits for the availability check\'s port, and claims it once the check releases it', async () => {
      const check = portClaims.claim([31001], ClaimKind.CHECK, 'availabilityCheck');
      let answered = null;
      const install = portClaims.claimForInstall([31001, 31002], 'appone', InstallStep.INSTALL).then((result) => { answered = result; });

      await settle();
      expect(answered, 'claimed while the check listened').to.equal(null);
      expect(portClaims.holderOf([31002]), 'held a port while waiting').to.equal(null);

      portClaims.release(check);
      await install;
      expect(answered.claim).to.include({ owner: 'appone' });
      expect(portClaims.claimedPorts()).to.have.members([31001, 31002]);
      portClaims.release(answered.claim);
    });

    it('does not wait for a port another installation holds, and names that installation', async () => {
      const other = portClaims.claim([31001], ClaimKind.INSTALL, 'appone');

      const { claim, heldBy } = await portClaims.claimForInstall([31001], 'appone', InstallStep.INSTALL);

      expect(claim).to.equal(null);
      expect(heldBy).to.equal(other);
      portClaims.release(other);
    });

    it('does not wait for an installation that claims the port while it waits for the check', async () => {
      const check = portClaims.claim([31001], ClaimKind.CHECK, 'availabilityCheck');
      const install = portClaims.claimForInstall([31001], 'apptwo', InstallStep.INSTALL);

      portClaims.release(check);
      const other = portClaims.claim([31001], ClaimKind.INSTALL, 'appone');
      const { claim, heldBy } = await install;

      expect(claim).to.equal(null);
      expect(heldBy).to.equal(other);
      portClaims.release(other);
    });
  });
});
