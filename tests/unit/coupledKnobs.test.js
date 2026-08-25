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
    expect(knobs.PRODUCTION.residentialQueueBaseMs).to.equal(fluxapps.residentialQueueBaseMs);
    expect(knobs.PRODUCTION.residentialQueueStepMs).to.equal(fluxapps.residentialQueueStepMs);
  });

  it('derives the ratio production actually runs at', () => {
    const { fluxapps } = productionConfig();
    const pass = fluxapps.removeFluxAppsPeriod * knobs.PON_SPEED_MULTIPLIER * knobs.PRODUCTION.blockMs;

    expect(knobs.productionQueueRatio()).to.equal(fluxapps.residentialQueueStepMs / pass);
    // Above one is the property itself: a step shorter than a pass cannot
    // separate two positions, whatever else is true.
    expect(knobs.productionQueueRatio()).to.be.above(1);
  });

  it('rejects a harness fleet whose step is shorter than its pass', () => {
    // The state suite 55 shipped in: a step chosen against a 250ms poll, left
    // behind when the poll moved to 833ms.
    const fluxapps = {
      removeFluxAppsPeriod: 4, explorerPollIntervalMs: 833, residentialQueueStepMs: 15000,
    };

    expect(() => knobs.assertCoupledRatios(fluxapps)).to.throw(/too short/);
  });

  it('accepts what the derivation produces for that same fleet', () => {
    const fleet = { removeFluxAppsPeriod: 4, explorerPollIntervalMs: 833 };

    expect(() => knobs.assertCoupledRatios({
      ...fleet, residentialQueueStepMs: knobs.derivedQueueStepMs(fleet),
    })).to.not.throw();
  });

  it('rejects a harness fleet whose departure interval is inside its ticket gap', () => {
    // The state suite 55 shipped in once the ticket learned to restart: a 4s
    // interval against a ~29s step. The block stops reading as a gap, tickets
    // carry straight across it, and the suite goes green on a queue that has
    // stopped separating anything after the first departure.
    const fleet = { removeFluxAppsPeriod: 4, explorerPollIntervalMs: 833 };
    const fluxapps = {
      ...fleet,
      residentialQueueStepMs: knobs.derivedQueueStepMs(fleet),
      residentialEvacuationIntervalMs: 4000,
    };

    expect(() => knobs.assertCoupledRatios(fluxapps)).to.throw(/does not outlive the queue ticket/);
  });

  it('accepts the departure interval its own derivation produces', () => {
    const fleet = { removeFluxAppsPeriod: 4, explorerPollIntervalMs: 833 };
    const fluxapps = { ...fleet, residentialQueueStepMs: knobs.derivedQueueStepMs(fleet) };

    expect(() => knobs.assertCoupledRatios({
      ...fluxapps,
      residentialEvacuationIntervalMs: knobs.derivedEvacuationIntervalMs(fluxapps),
    })).to.not.throw();
  });

  it('keeps the departure interval above the step, as production does', () => {
    const { fluxapps } = productionConfig();

    // 6h against a 40min step. The rule only demands step + a pass; production
    // clears it by an order of magnitude, and this is what says so out loud.
    expect(fluxapps.residentialEvacuationIntervalMs)
      .to.be.above(fluxapps.residentialQueueStepMs);
    expect(() => knobs.assertDepartureOutlivesTicket({
      removeFluxAppsPeriod: fluxapps.removeFluxAppsPeriod,
      explorerPollIntervalMs: fluxapps.explorerPollIntervalMs,
      residentialQueueStepMs: fluxapps.residentialQueueStepMs,
      residentialEvacuationIntervalMs: fluxapps.residentialEvacuationIntervalMs,
    })).to.not.throw();
  });

  it('moves the derived step when the poll moves', () => {
    // The whole failure in one assertion: a literal does not do this.
    const slow = knobs.derivedQueueStepMs({ removeFluxAppsPeriod: 4, explorerPollIntervalMs: 833 });
    const fast = knobs.derivedQueueStepMs({ removeFluxAppsPeriod: 4, explorerPollIntervalMs: 250 });

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

  it('leaves a step longer than production needs alone', () => {
    // A suite that does not compress this at all is slow, not wrong, and the
    // check must not push anyone toward a tighter number than they wanted.
    const fleet = { removeFluxAppsPeriod: 4, explorerPollIntervalMs: 833 };

    expect(() => knobs.assertCoupledRatios({ ...fleet, residentialQueueStepMs: 40 * 60 * 1000 })).to.not.throw();
  });
});
