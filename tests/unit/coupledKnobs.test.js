const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();

// coupled-knobs.js holds production's side of every harness ratio as constants,
// because ZelBack/config/default.js requires the gitignored config/userconfig.js
// and the harness cannot resolve it. Constants copied from a file drift from it;
// this is what makes the drift fail rather than quietly weaken the check the
// harness runs on every fleet boot.
describe('coupled harness knobs track production', () => {
  let knobs;

  before(async () => {
    // The extension is required: this is a real ESM specifier resolved at
    // runtime, not a bundler-resolved one, and the harness is ESM while this
    // file is CJS.
    // eslint-disable-next-line import/extensions
    knobs = await import('../../test-infra/runner/framework/coupled-knobs.js');
  });

  function productionConfig() {
    return proxyquire('../../ZelBack/config/default', {
      '../../config/userconfig': { initial: { development: false } },
    });
  }

  it('holds the same numbers the fleet reads', () => {
    const { fluxapps } = productionConfig();

    expect(knobs.PRODUCTION.removeFluxAppsPeriod).to.equal(fluxapps.removeFluxAppsPeriod);
    expect(knobs.PRODUCTION.residentialTurnMs).to.equal(fluxapps.residentialTurnMs);
    expect(knobs.PRODUCTION.peerSetDipWindowMinutes).to.equal(fluxapps.peerSetDipWindowMinutes);
    expect(knobs.PRODUCTION.peerSetDipEvaluateMs).to.equal(fluxapps.peerSetDipEvaluateMs);
  });

  it('gives a partitioning suite production\'s miss count, not the compressed one', () => {
    const { peers } = productionConfig();

    expect(knobs.PRODUCTION.wsMaxMissedPongs).to.equal(peers.wsMaxMissedPongs);
    expect(knobs.PRODUCTION.wsPingIntervalMs).to.equal(peers.wsPingIntervalMs);
    // The pair is the point. A suite that takes only the interval inherits the
    // shared fleet's 2 and quietly runs at two thirds of the margin it states.
    expect(knobs.PARTITION_PEERS.wsMaxMissedPongs).to.equal(peers.wsMaxMissedPongs);
    // The harness never runs at production's interval, so this one is compressed
    // - which is exactly why the miss count beside it must not be.
    expect(knobs.PARTITION_PEERS.wsPingIntervalMs).to.be.below(peers.wsPingIntervalMs);
  });

  it('refuses to derive a peer death from a config that is missing either half', () => {
    const shared = knobs.loadSharedConfig().peers;

    expect(knobs.peerDeathMs(shared)).to.equal(shared.wsPingIntervalMs * (shared.wsMaxMissedPongs + 1));
    expect(knobs.peerDeathMs(knobs.PARTITION_PEERS)).to.equal(12000);
    // No production fallback. It would return 60s where the shared fleet's real
    // answer is 6s, and an over-long budget passes every wait it is given, so the
    // caller's omission would never surface.
    expect(() => knobs.peerDeathMs({ wsPingIntervalMs: 3000 })).to.throw(/wsMaxMissedPongs/);
    expect(() => knobs.peerDeathMs({ wsMaxMissedPongs: 3 })).to.throw(/wsPingIntervalMs/);
    expect(() => knobs.peerDeathMs(undefined)).to.throw(/EFFECTIVE peers config/);
  });

  // Suite 103 compresses a two-hour window into minutes and has to bring the
  // sweep that releases the DOS down with it. A suite that shortened only the
  // window would sit through a tick that never comes and read as the rule
  // holding the node out - which is exactly what the suite next to it asserts,
  // so the failure would look like a pass.
  it('derives how many release sweeps a window holds', () => {
    const { fluxapps } = productionConfig();
    const expected = (fluxapps.peerSetDipWindowMinutes * 60 * 1000) / fluxapps.peerSetDipEvaluateMs;

    expect(knobs.peerSetSweepsPerWindow()).to.equal(expected);
    // Above one is the property: a window swept less than once cannot release
    // anything, whatever else is true.
    expect(knobs.peerSetSweepsPerWindow()).to.be.above(1);
  });

  it('derives the passes per turn production actually runs at', () => {
    const { fluxapps } = productionConfig();
    const pass = fluxapps.removeFluxAppsPeriod * knobs.PON_SPEED_MULTIPLIER * knobs.PRODUCTION.blockMs;

    expect(knobs.productionTurnRatio()).to.equal(fluxapps.residentialTurnMs / pass);
    // Two is the property: a holder acts on the second pass of its turn.
    expect(knobs.productionTurnRatio()).to.be.at.least(2);
  });

  it('holds the announcement cadence the product announces at', () => {
    const { fluxapps } = productionConfig();
    const appConstants = proxyquire('../../ZelBack/src/services/utils/appConstants', {
      config: { fluxapps, database: productionConfig().database },
    });

    expect(knobs.announcementLeftAtRenewalMs(fluxapps.locationTtlS))
      .to.equal(appConstants.RUNNING_EXPIRY_MS - appConstants.ANNOUNCE_INTERVAL_MS);
  });

  it('rejects a turn holding fewer passes than production\'s', () => {
    const fleet = { removeFluxAppsPeriod: 2, explorerPollIntervalMs: 833, locationTtlS: 63 };
    const pass = knobs.giveUpPassMs(fleet, knobs.harnessBlockCostMs(fleet));

    expect(() => knobs.assertTurnPacing({ ...fleet, residentialTurnMs: Math.floor(2 * pass) }))
      .to.throw(/holds too few give-up passes/);
  });

  it('accepts what the derivation produces for suite 55\'s fleet', () => {
    const fleet = { removeFluxAppsPeriod: 2, explorerPollIntervalMs: 833, locationTtlS: 63 };

    expect(() => knobs.assertTurnPacing({ ...fleet, residentialTurnMs: knobs.derivedTurnMs(fleet) })).to.not.throw();
  });

  it('rejects a fleet where a departure cannot be seen before the next holder decides', () => {
    // One pass separates two holders acting, so the pass itself has to outlast
    // what a departure costs to become visible: 1 x 4 blocks at 300ms is a
    // 1440ms pass.
    const fleet = { removeFluxAppsPeriod: 1, explorerPollIntervalMs: 300 };
    expect(knobs.giveUpPassMs(fleet, knobs.harnessBlockCostMs(fleet))).to.be.below(knobs.DEPARTURE_ANNOUNCE_MS);

    expect(() => knobs.assertTurnPacing({ ...fleet, residentialTurnMs: knobs.derivedTurnMs(fleet) }))
      .to.throw(/cannot be announced before the next holder decides/);
  });

  it('rejects a turn that a renewed announcement does not outlast', () => {
    // No holder would act: each refuses a turn its own announcement lapses in.
    const fleet = { removeFluxAppsPeriod: 2, explorerPollIntervalMs: 833, locationTtlS: 63 };

    expect(() => knobs.assertTurnPacing({
      ...fleet, residentialTurnMs: knobs.announcementLeftAtRenewalMs(63),
    })).to.throw(/outlasts a renewed announcement/);
  });

  it('moves the derived turn when the poll moves', () => {
    const slow = knobs.derivedTurnMs({ removeFluxAppsPeriod: 4, explorerPollIntervalMs: 833 });
    const fast = knobs.derivedTurnMs({ removeFluxAppsPeriod: 4, explorerPollIntervalMs: 250 });

    expect(slow).to.be.above(fast);
  });

  it('models the pass close to the one that was measured', () => {
    // BLOCK_COST_OVERHEAD is calibrated, not chosen: nine consecutive give-up
    // passes on cindy at explorerPollIntervalMs 833 ran 15.9s apart, against a
    // poll-only model of 13.3s. Without this the factor can be edited freely -
    // dropping it to 1.0 derives a 25s step instead of 30s, still above one but
    // below production's ratio, and nothing else in this file notices.
    const MEASURED_PASS_MS = 15900; // cindy, 2026-08-20, suite 55
    const modelled = knobs.giveUpPassMs(
      { removeFluxAppsPeriod: 4 },
      knobs.harnessBlockCostMs({ explorerPollIntervalMs: 833 }),
    );

    expect(Math.abs(modelled - MEASURED_PASS_MS) / MEASURED_PASS_MS).to.be.below(0.05);
  });

  it('holds the sigterm window below the running expiry, in production', () => {
    const { fluxapps } = productionConfig();

    expect(knobs.PRODUCTION.sigtermExpiryS).to.equal(fluxapps.sigtermExpiryS);
    expect(knobs.PRODUCTION.locationTtlS).to.equal(fluxapps.locationTtlS);
    // The ordering IS the property: appStartupManager expires on
    // (cleanShutdown && downtime > sigterm) || downtime > running.
    expect(fluxapps.sigtermExpiryS).to.be.below(fluxapps.locationTtlS);
  });

  it('rejects a fleet where the running expiry pre-empts the sigterm window', () => {
    // What making locationTtlS live did: 420s against 63s, so the clean-shutdown
    // grace became unreachable and a node down 300s deleted its apps.
    expect(() => knobs.assertSigtermOrdering({ sigtermExpiryS: 420, locationTtlS: 63 }))
      .to.throw(/not below locationTtlS/);
  });

  it('rejects a sigterm window no fixture could land inside', () => {
    // Production's 120x would give 3.5s, and one node boot is 16s. A window
    // smaller than the boot cannot be tested from the inside at all - which is
    // the trap in compressing a knob measured across real work.
    expect(() => knobs.assertSigtermOrdering({ sigtermExpiryS: 3.5, locationTtlS: 63 }))
      .to.throw(/at or below one node boot/);
  });

  it('accepts the harness pair as shipped', () => {
    const shared = knobs.loadSharedConfig().fluxapps;

    expect(shared.sigtermExpiryS).to.be.above(knobs.BOOT_DRIFT_MS / 1000);
    expect(shared.sigtermExpiryS).to.be.below(shared.locationTtlS);
    expect(() => knobs.assertSigtermOrdering(shared)).to.not.throw();
  });

  it('holds production\'s election cycle and stagger', () => {
    const { fluxapps } = productionConfig();

    expect(knobs.PRODUCTION.masterSlaveIntervalMs).to.equal(fluxapps.masterSlaveIntervalMs);
    expect(knobs.PRODUCTION.masterSlaveStaggerMs).to.equal(fluxapps.masterSlaveStaggerMs);
  });

  it('rejects a stagger that spans fewer election passes than production\'s', () => {
    const pass = 3000;
    const tooShort = (knobs.staggerPassesPerPlace() - 1) * pass;

    expect(() => knobs.assertCoupledRatios({ masterSlaveIntervalMs: pass, masterSlaveStaggerMs: tooShort }))
      .to.throw(/spans too few election passes/);
    expect(() => knobs.assertCoupledRatios({
      masterSlaveIntervalMs: pass, masterSlaveStaggerMs: knobs.staggerPassesPerPlace() * pass,
    })).to.not.throw();
  });

  it('accepts the shared fleet\'s stagger', () => {
    expect(() => knobs.assertStaggerSpansElectionPasses(knobs.loadSharedConfig().fluxapps)).to.not.throw();
  });

  it('leaves a turn longer than production needs alone', () => {
    // A suite that does not compress this at all is slow, not wrong, and the
    // check must not push anyone toward a tighter number than they wanted.
    const fleet = { removeFluxAppsPeriod: 4, explorerPollIntervalMs: 833 };

    expect(() => knobs.assertCoupledRatios({ ...fleet, residentialTurnMs: 60 * 60 * 1000 })).to.not.throw();
  });
});
