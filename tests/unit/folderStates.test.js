const { expect } = require('chai');
const folderStates = require('../../ZelBack/src/services/appMonitoring/folderStates');
const { folderStates: folderStateMap, publishedFileBytes } = require('../../ZelBack/src/services/utils/globalState');

describe('folderStates tests', () => {
  beforeEach(() => {
    folderStateMap.clear();
    publishedFileBytes.clear();
  });

  afterEach(() => {
    folderStateMap.clear();
  });

  describe('published', () => {
    it('answers what a writable folder holds in the index, zero included', () => {
      folderStates.published('fluxempty_app', 0);
      folderStates.published('fluxfull_app', 4096);

      expect(folderStates.answer(new Set(['fluxempty_app', 'fluxfull_app'])).published)
        .to.deep.equal({ fluxempty_app: 0, fluxfull_app: 4096 });
    });

    it('answers nothing for a folder that no longer sends', () => {
      folderStates.published('fluxr_app', 0);

      expect(folderStates.answer(new Set()).published).to.deep.equal({});
    });

    it('withdraws the figure when the status cannot be read', () => {
      folderStates.published('fluxr_app', 0);
      folderStates.published('fluxr_app', null);

      expect(folderStates.answer(new Set(['fluxr_app'])).published).to.deep.equal({});
    });

    it('tells a folder publishing bytes from one publishing nothing or unread', () => {
      folderStates.published('fluxfull_app', 4096);
      folderStates.published('fluxempty_app', 0);

      expect(folderStates.publishesBytes('fluxfull_app')).to.equal(true);
      expect(folderStates.publishesBytes('fluxempty_app')).to.equal(false);
      expect(folderStates.publishesBytes('fluxunread_app')).to.equal(false);
    });

    it('forgets a removed folder', () => {
      folderStates.published('fluxr_app', 0);
      folderStates.removed('fluxr_app');

      expect(publishedFileBytes.has('fluxr_app')).to.equal(false);
    });
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

      expect(folderStates.answer(new Set())).to.deep.equal({
        holding: { fluxa: { unreadable: true } }, notLookedAt: [], heldOut: [], volumeGone: [], published: {},
      });
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
    it('lists each folder in one list by its state, and leaves out writable ones', () => {
      folderStateMap.set('fluxwait', { state: 'notLookedAt' });
      folderStateMap.set('fluxheld', { state: 'measured', bytes: 5, newestModified: 1 });
      folderStateMap.set('fluxnone', { state: 'noClaim' });
      folderStateMap.set('fluxout', { state: 'heldOut' });
      folderStateMap.set('fluxgone', { state: 'volumeGone' });
      folderStateMap.set('fluxsend', { state: 'measured', bytes: 9, newestModified: 9 });
      folderStateMap.set('fluxsendwait', { state: 'notLookedAt' });

      expect(folderStates.answer(new Set(['fluxsend', 'fluxsendwait']))).to.deep.equal({
        holding: {
          fluxheld: { bytes: 5, newestModified: 1 },
          fluxnone: { unreadable: true },
        },
        notLookedAt: ['fluxwait'],
        heldOut: ['fluxout'],
        volumeGone: ['fluxgone'],
        published: {},
      });
    });

    it('keeps a folder whose volume image is gone when it is found unmounted without asking why, and holds out any other', () => {
      folderStates.volumeGone('fluxgone');
      folderStates.measured('fluxmeasured', { bytes: 5, newestModified: 1 });

      folderStates.notMounted('fluxgone');
      folderStates.notMounted('fluxmeasured');

      expect(folderStateMap.get('fluxgone')).to.deep.equal({ state: 'volumeGone' });
      expect(folderStateMap.get('fluxmeasured')).to.deep.equal({ state: 'heldOut' });
    });

    it('keeps a folder whose volume image is gone when its app\'s spec cannot be read, and holds out any other', () => {
      folderStates.volumeGone('fluxgone');
      folderStates.measured('fluxmeasured', { bytes: 5, newestModified: 1 });
      folderStates.installed({ name: 'fluxwait', version: 3, containerData: 'g:/appdata' });

      ['fluxgone', 'fluxmeasured', 'fluxwait', 'fluxnew'].forEach((folderId) => folderStates.specUnreadable(folderId));

      expect(folderStateMap.get('fluxgone')).to.deep.equal({ state: 'volumeGone' });
      expect(folderStateMap.get('fluxmeasured')).to.deep.equal({ state: 'heldOut' });
      expect(folderStateMap.get('fluxwait')).to.deep.equal({ state: 'heldOut' });
      expect(folderStateMap.get('fluxnew')).to.deep.equal({ state: 'heldOut' });
    });

    it('holds out a folder whose volume image was gone once the mount check finds it on the node', () => {
      folderStates.volumeGone('fluxa');

      folderStates.heldOut('fluxa');

      expect(folderStateMap.get('fluxa')).to.deep.equal({ state: 'heldOut' });
    });
  });
});
