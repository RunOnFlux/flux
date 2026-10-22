const { expect } = require('chai');
const folderStates = require('../../ZelBack/src/services/appMonitoring/folderStates');
const { folderStates: folderStateMap } = require('../../ZelBack/src/services/utils/globalState');

describe('folderStates tests', () => {
  beforeEach(() => {
    folderStateMap.clear();
  });

  afterEach(() => {
    folderStateMap.clear();
  });

  describe('installed', () => {
    it('records each g: and r: component of an app, and no s: or unsynced one', () => {
      folderStates.installed({
        name: 'app',
        version: 4,
        compose: [
          { name: 'g', containerData: 'g:/data' },
          { name: 'r', containerData: 'r:/data' },
          { name: 's', containerData: 's:/data' },
          { name: 'plain', containerData: '/data' },
        ],
      });

      expect([...folderStateMap.keys()]).to.have.members(['fluxg_app', 'fluxr_app']);
      expect(folderStateMap.get('fluxg_app')).to.deep.equal({ state: 'notLookedAt' });
    });

    it('records the single folder of an app from before compose', () => {
      folderStates.installed({ name: 'legacy', version: 3, containerData: 'g:/data' });

      expect(folderStateMap.get('fluxlegacy')).to.deep.equal({ state: 'notLookedAt' });
    });

    it('keeps the state of a folder it already has', () => {
      folderStateMap.set('fluxlegacy', { state: 'heldOut' });

      folderStates.installed({ name: 'legacy', version: 3, containerData: 'g:/data' });

      expect(folderStateMap.get('fluxlegacy')).to.deep.equal({ state: 'heldOut' });
    });
  });

  describe('measured', () => {
    it('records what it holds as a claim', () => {
      folderStates.measured('fluxa', { bytes: 10, newestModified: 2 });

      expect(folderStates.claimOf('fluxa')).to.deep.equal({ bytes: 10, newestModified: 2 });
    });

    it('records holdings it could not read as no claim', () => {
      folderStates.measured('fluxa', { bytes: 10, newestModified: 2 });
      folderStates.measured('fluxa', null);

      expect(folderStateMap.get('fluxa')).to.deep.equal({ state: 'noClaim' });
      expect(folderStates.claimOf('fluxa')).to.equal(folderStates.NO_CLAIM_ANSWER);
    });
  });

  describe('claimOf', () => {
    it('claims nothing, and is not no claim, for a folder not looked at or not held', () => {
      folderStateMap.set('fluxa', { state: 'notLookedAt' });

      expect(folderStates.claimOf('fluxa')).to.equal(undefined);
      expect(folderStates.claimOf('fluxmissing')).to.equal(undefined);
    });

    it('answers no claim for a folder held out', () => {
      folderStates.heldOut('fluxa');

      expect(folderStates.claimOf('fluxa')).to.equal(folderStates.NO_CLAIM_ANSWER);
    });
  });

  describe('the folder lifecycle', () => {
    it('makes a promoted folder no claim, and keeps it so once it no longer sends', () => {
      folderStates.measured('fluxa', { bytes: 10, newestModified: 2 });

      folderStates.sending('fluxa');

      expect(folderStates.answer(new Set())).to.deep.equal({ holding: { fluxa: { unreadable: true } }, notLookedAt: [] });
    });

    it('makes a recreated volume not looked at', () => {
      folderStates.measured('fluxa', { bytes: 10, newestModified: 2 });

      folderStates.recreated('fluxa');

      expect(folderStates.answer(new Set()).notLookedAt).to.deep.equal(['fluxa']);
    });

    it('forgets a removed folder', () => {
      folderStates.heldOut('fluxa');

      folderStates.removed('fluxa');

      expect(folderStateMap.has('fluxa')).to.equal(false);
    });
  });

  describe('answer', () => {
    it('lists folders not looked at apart from what it holds, and leaves out writable ones', () => {
      folderStateMap.set('fluxwait', { state: 'notLookedAt' });
      folderStateMap.set('fluxheld', { state: 'measured', bytes: 5, newestModified: 1 });
      folderStateMap.set('fluxout', { state: 'heldOut' });
      folderStateMap.set('fluxsend', { state: 'measured', bytes: 9, newestModified: 9 });
      folderStateMap.set('fluxsendwait', { state: 'notLookedAt' });

      const { holding, notLookedAt } = folderStates.answer(new Set(['fluxsend', 'fluxsendwait']));

      expect(notLookedAt).to.deep.equal(['fluxwait']);
      expect(holding).to.deep.equal({
        fluxheld: { bytes: 5, newestModified: 1 },
        fluxout: { unreadable: true },
      });
    });
  });
});
