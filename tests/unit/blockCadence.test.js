const { expect } = require('chai');

const { BlockCadence } = require('../../ZelBack/src/services/utils/blockCadence');

describe('BlockCadence tests', () => {
  /** Asks about `job` at each height in turn, every height processed, and returns where it ran. */
  function runsAt(cadence, job, heights, period) {
    return heights.filter((height) => {
      cadence.processed(height);
      return cadence.due(job, height, period);
    });
  }

  it('runs on every multiple of its period when every block is processed at the tip', () => {
    const heights = Array.from({ length: 25 }, (_, i) => 100 + i);
    expect(runsAt(new BlockCadence(), 'job', heights, 8)).to.deep.equal([104, 112, 120]);
  });

  it('runs once, on the block that reaches the tip, for a multiple passed during a burst', () => {
    const cadence = new BlockCadence();
    // 100..103 at the tip; 104..111 processed back to back, only 111 at the tip
    [100, 101, 102, 103].forEach((h) => { cadence.processed(h); cadence.due('job', h, 8); });
    for (let h = 104; h < 111; h += 1) cadence.processed(h);
    cadence.processed(111);
    expect(cadence.due('job', 111, 8)).to.equal(true);
    cadence.processed(112);
    expect(cadence.due('job', 112, 8)).to.equal(true);
    cadence.processed(113);
    expect(cadence.due('job', 113, 8)).to.equal(false);
  });

  it('runs once, not once for each multiple, for a burst that passes several', () => {
    const cadence = new BlockCadence();
    cadence.processed(100);
    cadence.due('job', 100, 2);
    for (let h = 101; h < 110; h += 1) cadence.processed(h);
    cadence.processed(110);
    expect(cadence.due('job', 110, 2)).to.equal(true);
    cadence.processed(111);
    expect(cadence.due('job', 111, 2)).to.equal(false);
  });

  it('runs once for the multiples passed while catching up after a start', () => {
    const cadence = new BlockCadence();
    // the scan starts at 90 and first reaches the tip at 107
    for (let h = 90; h < 107; h += 1) cadence.processed(h);
    cadence.processed(107);
    expect(cadence.due('job', 107, 8)).to.equal(true);
  });

  it('waits for the next multiple when a node starts at the tip between two', () => {
    const cadence = new BlockCadence();
    cadence.processed(105);
    expect(cadence.due('job', 105, 8)).to.equal(false);
    cadence.processed(106);
    expect(cadence.due('job', 106, 8)).to.equal(false);
    cadence.processed(112);
    expect(cadence.due('job', 112, 8)).to.equal(true);
  });

  it('keeps each job to its own count', () => {
    const cadence = new BlockCadence();
    [100, 101, 102, 103].forEach((h) => cadence.processed(h));
    expect(cadence.due('every2', 103, 2)).to.equal(true);
    expect(cadence.due('every8', 103, 8)).to.equal(false);
    cadence.processed(104);
    expect(cadence.due('every2', 104, 2)).to.equal(true);
    expect(cadence.due('every8', 104, 8)).to.equal(true);
  });

  it('runs a job not asked about for a while once, when next asked past a multiple', () => {
    const cadence = new BlockCadence();
    cadence.processed(100);
    expect(cadence.due('job', 100, 8)).to.equal(false);
    // not asked at 104 (its gate was closed), then asked at 106
    for (let h = 101; h <= 106; h += 1) cadence.processed(h);
    expect(cadence.due('job', 106, 8)).to.equal(true);
  });
});
