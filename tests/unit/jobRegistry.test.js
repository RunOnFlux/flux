const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const { expect } = chai;

const jobRegistry = require('../../ZelBack/src/services/utils/jobRegistry');

describe('jobRegistry tests', () => {
  afterEach(() => {
    sinon.restore();
    jobRegistry.reset();
  });

  describe('the envelope', () => {
    it('starts an operation Running, with a handle pointing at the shared resource', () => {
      const handle = jobRegistry.start({ kind: 'imagepreflight' });

      expect(handle.jobId).to.match(/^op_/);
      expect(handle.statusUrl).to.equal(`/apps/operations/${handle.jobId}`);

      const view = jobRegistry.get(handle.jobId);
      expect(view.status).to.equal('Running');
      expect(view.kind).to.equal('imagepreflight');
    });

    it('reads the service\'s own payload at poll time, not at transition time', () => {
      // The point of the detail callback: a service keeps its domain state where
      // it already lives instead of copying it into the registry on every step.
      const state = { done: 0 };
      const handle = jobRegistry.start({ kind: 'test', detail: () => ({ done: state.done }) });

      expect(jobRegistry.get(handle.jobId).detail).to.deep.equal({ done: 0 });
      state.done = 3;
      expect(jobRegistry.get(handle.jobId).detail).to.deep.equal({ done: 3 });
    });

    it('uses one status enum for success and failure alike', () => {
      const ok = jobRegistry.start({ kind: 'test' });
      jobRegistry.succeed(ok.jobId);
      expect(jobRegistry.get(ok.jobId).status).to.equal('Succeeded');

      const bad = jobRegistry.start({ kind: 'test' });
      jobRegistry.fail(bad.jobId, new Error('nope'));
      expect(jobRegistry.get(bad.jobId).status).to.equal('Failed');
    });

    it('does not let a terminal operation change status again', () => {
      const handle = jobRegistry.start({ kind: 'test' });
      jobRegistry.succeed(handle.jobId);
      jobRegistry.fail(handle.jobId, new Error('too late'));

      expect(jobRegistry.get(handle.jobId).status).to.equal('Succeeded');
      expect(jobRegistry.get(handle.jobId).error).to.equal(null);
    });

    it('keeps progress append-only so a client that missed a poll loses nothing', () => {
      const handle = jobRegistry.start({ kind: 'test' });
      jobRegistry.progress(handle.jobId, 'one');
      jobRegistry.progress(handle.jobId, 'two');

      const messages = jobRegistry.get(handle.jobId).progress.map((entry) => entry.message);
      expect(messages).to.deep.equal(['one', 'two']);
    });
  });

  describe('failures', () => {
    it('shapes an error as problem+json pointing back at the operation', () => {
      const handle = jobRegistry.start({ kind: 'test' });
      jobRegistry.fail(handle.jobId, new Error('registry unreachable'));

      const { error } = jobRegistry.get(handle.jobId);
      expect(error.title).to.equal('Error');
      expect(error.detail).to.equal('registry unreachable');
      expect(error.instance).to.equal(`/apps/operations/${handle.jobId}`);
    });

    it('carries a coded failure through, so a caller can act on it', () => {
      const handle = jobRegistry.start({ kind: 'test' });
      jobRegistry.fail(handle.jobId, {
        title: 'Registry rate limited', status: 429, detail: 'cooling', code: 'REGISTRY_BUSY', retryAfterMs: 900000,
      });

      const { error } = jobRegistry.get(handle.jobId);
      expect(error.code).to.equal('REGISTRY_BUSY');
      expect(error.retryAfterMs).to.equal(900000);
      expect(error.status).to.equal(429);
    });

    it('scrubs credentials out of a failure detail', () => {
      // A registry auth failure can carry the credentials in its message, and
      // this string is served in a response body.
      const handle = jobRegistry.start({ kind: 'test' });
      jobRegistry.fail(handle.jobId, new Error('auth failed for myuser:sup3rsecret@registry.example.com'));

      const { error } = jobRegistry.get(handle.jobId);
      expect(error.detail).to.not.include('sup3rsecret');
      expect(error.detail).to.include('<credentials>');
    });

    it('scrubs a provider credential string too', () => {
      const handle = jobRegistry.start({ kind: 'test' });
      jobRegistry.fail(handle.jobId, new Error('bad config: aws://AKIAsomethingsecret@eu-west-1'));

      expect(jobRegistry.get(handle.jobId).error.detail).to.not.include('AKIAsomethingsecret');
    });
  });

  describe('ownership', () => {
    it('answers only the owner, and answers not-found rather than forbidden', () => {
      // Unknown and not-yours have to be the same answer, or a jobId becomes a
      // probe for whether someone else has an operation running.
      const handle = jobRegistry.start({ kind: 'test', owner: 'F1' });

      expect(jobRegistry.get(handle.jobId, 'F1')).to.not.equal(null);
      expect(jobRegistry.get(handle.jobId, 'F2')).to.equal(null);
      expect(jobRegistry.get(handle.jobId, null)).to.equal(null);
      expect(jobRegistry.get('op_nope', 'F1')).to.equal(null);
    });

    it('treats the jobId as the capability when an operation has no owner', () => {
      const handle = jobRegistry.start({ kind: 'test' });
      expect(jobRegistry.get(handle.jobId, null)).to.not.equal(null);
      expect(jobRegistry.get(handle.jobId, 'anyone')).to.not.equal(null);
    });
  });

  describe('cancellation', () => {
    it('requests a cancel without claiming the work has stopped', () => {
      // Best effort: the worker notices at its next checkpoint, so the status
      // stays Running until it actually stops.
      const handle = jobRegistry.start({ kind: 'test' });

      expect(jobRegistry.requestCancel(handle.jobId)).to.equal(true);
      expect(jobRegistry.isCanceled(handle.jobId)).to.equal(true);
      expect(jobRegistry.get(handle.jobId).status).to.equal('Running');

      jobRegistry.cancelled(handle.jobId);
      expect(jobRegistry.get(handle.jobId).status).to.equal('Canceled');
    });

    it('refuses to cancel something already finished', () => {
      const handle = jobRegistry.start({ kind: 'test' });
      jobRegistry.succeed(handle.jobId);
      expect(jobRegistry.requestCancel(handle.jobId)).to.equal(false);
    });

    // "Notices at its next checkpoint" is only true if it reaches one. Work
    // that waits on events has no next checkpoint until an event arrives, so a
    // cancel has to be delivered rather than left to be discovered.
    it('tells the work a cancel was requested', () => {
      const onCancel = sinon.stub();
      const handle = jobRegistry.start({ kind: 'test', onCancel });

      jobRegistry.requestCancel(handle.jobId);

      expect(onCancel.calledOnce).to.equal(true);
    });

    it('does not call the handler for a cancel it refuses', () => {
      const onCancel = sinon.stub();
      const handle = jobRegistry.start({ kind: 'test', onCancel });
      jobRegistry.succeed(handle.jobId);

      jobRegistry.requestCancel(handle.jobId);

      expect(onCancel.called).to.equal(false);
    });

    it('still records the cancel when the handler throws', () => {
      // A handler is a courtesy to the work; the flag is the contract.
      const handle = jobRegistry.start({
        kind: 'test',
        onCancel: () => { throw new Error('watcher already gone'); },
      });

      expect(jobRegistry.requestCancel(handle.jobId)).to.equal(true);
      expect(jobRegistry.isCanceled(handle.jobId)).to.equal(true);
    });
  });

  describe('retention', () => {
    it('drops a terminal operation once its retention window passes', () => {
      const registry = proxyquire('../../ZelBack/src/services/utils/jobRegistry', {
        config: { fluxapps: { operationRetentionMs: 1000 } },
      });
      const clock = sinon.useFakeTimers();

      const handle = registry.start({ kind: 'test' });
      registry.succeed(handle.jobId);
      expect(registry.get(handle.jobId)).to.not.equal(null);

      clock.tick(1001);
      expect(registry.get(handle.jobId)).to.equal(null);
    });

    it('never expires an operation that is still running', () => {
      const registry = proxyquire('../../ZelBack/src/services/utils/jobRegistry', {
        config: { fluxapps: { operationRetentionMs: 1000 } },
      });
      const clock = sinon.useFakeTimers();

      const handle = registry.start({ kind: 'test' });
      clock.tick(600000);

      expect(registry.get(handle.jobId)).to.not.equal(null);
    });
  });
});
