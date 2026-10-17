const { expect } = require('chai');
const sinon = require('sinon');
const { withinDeadline, TIMED_OUT } = require('../../ZelBack/src/services/utils/withinDeadline');

describe('withinDeadline tests', () => {
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    clock.restore();
  });

  it('answers what the work resolved, when it resolves in time', async () => {
    expect(await withinDeadline(Promise.resolve('done'), 1000)).to.equal('done');
  });

  it('rejects with the work\'s own error, when it rejects in time', async () => {
    const failure = await withinDeadline(Promise.reject(new Error('refused')), 1000).catch((error) => error);

    expect(failure.message).to.equal('refused');
  });

  it('answers TIMED_OUT once the deadline passes first', async () => {
    const answer = withinDeadline(new Promise(() => {}), 1000);
    await clock.tickAsync(1000);

    expect(await answer).to.equal(TIMED_OUT);
  });

  it('leaves no timer behind once the work resolves', async () => {
    await withinDeadline(Promise.resolve('done'), 1000);

    expect(clock.countTimers()).to.equal(0);
  });
});
