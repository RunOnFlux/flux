const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();

describe('blockWindowHolds tests', () => {
  let height;
  let heightListener;
  let holds;

  beforeEach(() => {
    height = 1000;
    heightListener = null;
    holds = proxyquire('../../ZelBack/src/services/utils/blockWindowHolds', {
      '../daemonService/daemonServiceMiscRpcs': {
        chainHeight: () => height,
        onDaemonHeight: (listener) => { heightListener = listener; return () => { heightListener = null; }; },
      },
    });
  });

  it('keeps the heights inside the window, a null one taken as now, and every one while no height is known', () => {
    expect(holds.inWindow([500, 900, null], 1000, 200)).to.deep.equal([900, 1000]);
    expect(holds.inWindow([500, null], 0, 200)).to.deep.equal([500, null]);
  });

  it('starts a hold taken with no height at the first height, and ends it once its blocks have passed', () => {
    expect(holds.judgeHold({ fromHeight: null, blocks: 10 }, 0)).to.deep.equal({ fromHeight: null, blocks: 10 });
    expect(holds.judgeHold({ fromHeight: null, blocks: 10 }, 1000)).to.deep.equal({ fromHeight: 1000, blocks: 10 });
    expect(holds.judgeHold({ fromHeight: 1000, blocks: 10 }, 1009)).to.deep.equal({ fromHeight: 1000, blocks: 10 });
    expect(holds.judgeHold({ fromHeight: 1000, blocks: 10 }, 1010)).to.equal(null);
    expect(holds.judgeHold(null, 1010)).to.equal(null);
  });

  it('runs passes one after another in the order asked, each on what the one before stored', async () => {
    let stored = { events: [] };
    const applied = [];
    const rule = holds.blockWindowRule({
      load: async () => stored,
      save: async (before, after) => { await new Promise((resolve) => { setImmediate(resolve); }); stored = after; return true; },
      judge: (state) => state,
      apply: (state) => applied.push(state.events.length),
    });

    await Promise.all([1, 2, 3].map((n) => rule.pass((state) => ({ events: [...state.events, n] }))));

    expect(stored.events).to.deep.equal([1, 2, 3]);
    expect(applied).to.deep.equal([1, 2, 3]);
  });

  it('reads the state again when it changed between the read and the store', async () => {
    let stored = { events: [] };
    let raced = false;
    const rule = holds.blockWindowRule({
      load: async () => stored,
      save: async (before, after) => {
        if (!raced) {
          raced = true;
          stored = { events: ['written by another'] };
          return false;
        }
        stored = after;
        return true;
      },
      judge: (state) => state,
      apply: () => {},
    });

    await rule.pass((state) => ({ events: [...state.events, 'mine'] }));

    expect(stored.events).to.deep.equal(['written by another', 'mine']);
  });

  it('judges at every height the daemon reports once watching, and at once', async () => {
    const judged = [];
    const rule = holds.blockWindowRule({
      load: async () => ({}),
      save: async () => true,
      judge: (state, at) => { judged.push(at); return state; },
      apply: () => {},
    });

    const stop = rule.watch(() => {});
    await new Promise((resolve) => { setImmediate(resolve); });
    height = 1001;
    await heightListener();
    stop();

    expect(judged).to.deep.equal([1000, 1001]);
    expect(heightListener).to.equal(null);
  });
});
