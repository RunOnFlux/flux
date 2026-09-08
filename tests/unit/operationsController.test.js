const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const { expect } = chai;

describe('operationsController tests', () => {
  let verifyPrivilegeStub;
  let jobRegistry;

  function build() {
    verifyPrivilegeStub = sinon.stub().resolves(true);
    // The registry is the real one: the contract under test is how an operation
    // is presented, and stubbing it out would test the stub.
    // eslint-disable-next-line global-require
    jobRegistry = require('../../ZelBack/src/services/utils/jobRegistry');

    return proxyquire('../../ZelBack/src/services/appManagement/operationsController', {
      '../verificationHelper': { verifyPrivilege: verifyPrivilegeStub },
    });
  }

  function mkRes() {
    const res = {};
    res.status = sinon.stub().returns(res);
    res.json = sinon.stub().returns(res);
    res.setHeader = sinon.stub().returns(res);
    return res;
  }

  function mkReq(overrides = {}) {
    return {
      headers: { zelidauth: { zelid: 'F1' } },
      params: {},
      query: {},
      ...overrides,
    };
  }

  afterEach(() => {
    sinon.restore();
    if (jobRegistry) jobRegistry.reset();
  });

  describe('accepting work', () => {
    it('answers 202 with the handle in both the headers and the body', async () => {
      const controller = build();
      const res = mkRes();

      controller.accepted(res, { jobId: 'op_1', statusUrl: '/apps/operations/op_1' });

      expect(res.status.calledWith(202)).to.equal(true);
      // Location/Operation-Id are the long-running-operation spelling; the body
      // repeats them so a client that cannot read headers is not stuck.
      expect(res.setHeader.calledWith('Location', '/apps/operations/op_1')).to.equal(true);
      expect(res.setHeader.calledWith('Operation-Id', 'op_1')).to.equal(true);
      expect(res.setHeader.calledWith('Retry-After', '2')).to.equal(true);
      expect(res.json.firstCall.args[0].data).to.include({
        jobId: 'op_1', statusUrl: '/apps/operations/op_1', status: 'Running',
      });
    });

    it('echoes whatever else the endpoint wants to hand back', async () => {
      const controller = build();
      const res = mkRes();

      controller.accepted(res, { jobId: 'op_1', statusUrl: '/x' }, { messageHash: 'abc' });

      expect(res.json.firstCall.args[0].data.messageHash).to.equal('abc');
    });
  });

  describe('answering work that finished inline', () => {
    // An operation quick enough to beat its deadline answers on the original
    // request rather than handing back something to poll. That answer is built
    // from the JOB, and a job registered by an authenticated caller is owned -
    // so the read has to present the owner or the registry refuses it.

    it('reports a job that succeeded as a success', async () => {
      const controller = build();
      const res = mkRes();
      const handle = jobRegistry.start({ kind: 'fileoperation.remove', owner: 'F1' });
      jobRegistry.succeed(handle.jobId);

      controller.completed(res, handle, 'F1');

      expect(res.status.calledWith(200)).to.equal(true);
      expect(res.json.firstCall.args[0].status).to.equal('success');
      expect(res.json.firstCall.args[0].data).to.include({
        jobId: handle.jobId, status: 'Succeeded',
      });
    });

    it('reports a job that FAILED as a failure, carrying what went wrong', async () => {
      // The regression this covers: the read was made without an owner, so the
      // registry refused it, the job came back empty, and the answer fell
      // through to a hardcoded Succeeded. A remove that failed was reported to
      // its caller as having worked.
      const controller = build();
      const res = mkRes();
      const handle = jobRegistry.start({ kind: 'fileoperation.remove', owner: 'F1' });
      jobRegistry.fail(handle.jobId, new Error('File operation failed with exit code 2'));

      controller.completed(res, handle, 'F1');

      const body = res.json.firstCall.args[0];
      expect(body.status).to.equal('error');
      // message, name and code: the shape a failed file operation has always
      // answered with, so a client written before jobs existed still reads it.
      expect(body.data.message).to.equal('File operation failed with exit code 2');
      expect(body.data.name).to.equal('Error');
    });

    it('does not call a result it could not read a success', async () => {
      // Expired, evicted, or presented with the wrong identity - all one answer
      // from the registry. None of them means the work succeeded.
      const controller = build();
      const res = mkRes();
      const handle = jobRegistry.start({ kind: 'fileoperation.remove', owner: 'F1' });
      jobRegistry.succeed(handle.jobId);

      controller.completed(res, handle, 'someone-else');

      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('names the operation in the header whatever the outcome', async () => {
      const controller = build();
      const res = mkRes();
      const handle = jobRegistry.start({ kind: 'fileoperation.remove', owner: 'F1' });
      jobRegistry.fail(handle.jobId, new Error('nope'));

      controller.completed(res, handle, 'F1');

      expect(res.setHeader.calledWith('Operation-Id', handle.jobId)).to.equal(true);
    });
  });

  describe('polling', () => {
    it('tells a client when to come back while the operation runs', async () => {
      const controller = build();
      const handle = jobRegistry.start({ kind: 'test' });
      const res = mkRes();

      await controller.getOperation(mkReq({ params: { jobId: handle.jobId } }), res);

      expect(res.json.firstCall.args[0].data.status).to.equal('Running');
      expect(res.setHeader.calledWith('Retry-After', '2')).to.equal(true);
    });

    it('answers 200 for a FAILED operation - a failed job is still a successful poll', async () => {
      // Completion is read from the status field, never inferred from the HTTP
      // code: the poll worked, the operation did not.
      const controller = build();
      const handle = jobRegistry.start({ kind: 'test' });
      jobRegistry.fail(handle.jobId, new Error('it broke'));
      const res = mkRes();

      await controller.getOperation(mkReq({ params: { jobId: handle.jobId } }), res);

      expect(res.status.called).to.equal(false);
      expect(res.json.firstCall.args[0].data.status).to.equal('Failed');
      expect(res.json.firstCall.args[0].data.error.detail).to.equal('it broke');
    });

    it('stops sending Retry-After once the operation is terminal', async () => {
      const controller = build();
      const handle = jobRegistry.start({ kind: 'test' });
      jobRegistry.succeed(handle.jobId);
      const res = mkRes();

      await controller.getOperation(mkReq({ params: { jobId: handle.jobId } }), res);

      expect(res.setHeader.calledWith('Retry-After', '2')).to.equal(false);
      expect(res.setHeader.args.map((args) => args[0])).to.include('Expires');
    });

    // The cursor is caller input, so it is parsed rather than trusted. A
    // client's own bookkeeping decides what it has already read; the server
    // never discards, so a lost response costs nothing to re-ask for.
    describe('the read cursor', () => {
      function detailFor(query) {
        const controller = build();
        const seen = [];
        const handle = jobRegistry.start({
          kind: 'test',
          detail: (readOptions) => {
            seen.push(readOptions);
            return {};
          },
        });
        const res = mkRes();

        return controller
          .getOperation(mkReq({ params: { jobId: handle.jobId }, query }), res)
          .then(() => seen[0]);
      }

      it('passes a supplied cursor through to the operation', async () => {
        expect(await detailFor({ sinceSeq: '42' })).to.deep.equal({ sinceSeq: 42 });
      });

      it('reads no cursor as the whole retained view', async () => {
        expect(await detailFor({})).to.deep.equal({ sinceSeq: 0 });
      });

      it('ignores a cursor that is not a whole number, rather than truncating', async () => {
        // Answering a garbage cursor with "nothing new" would look identical to
        // a quiet log, and the client would never learn it had asked wrongly.
        for (const bad of ['abc', '-1', '1.5', 'Infinity', 'NaN', '1e400']) {
          // eslint-disable-next-line no-await-in-loop
          expect(await detailFor({ sinceSeq: bad }), bad).to.deep.equal({ sinceSeq: 0 });
        }
      });
    });

    it('404s an unknown job', async () => {
      const controller = build();
      const res = mkRes();

      await controller.getOperation(mkReq({ params: { jobId: 'op_nope' } }), res);

      expect(res.status.calledWith(404)).to.equal(true);
    });

    it('404s another owner\'s job rather than admitting it exists', async () => {
      const controller = build();
      const handle = jobRegistry.start({ kind: 'test', owner: 'SOMEONE_ELSE' });
      const res = mkRes();

      await controller.getOperation(mkReq({ params: { jobId: handle.jobId } }), res);

      expect(res.status.calledWith(404)).to.equal(true);
    });

    it('400s when no jobId was given at all', async () => {
      const controller = build();
      const res = mkRes();

      await controller.getOperation(mkReq({ params: {} }), res);

      expect(res.status.calledWith(400)).to.equal(true);
    });
  });

  describe('cancelling', () => {
    it('reports the cancel as requested, with the status still Running', async () => {
      const controller = build();
      const handle = jobRegistry.start({ kind: 'test' });
      const res = mkRes();

      await controller.cancelOperation(mkReq({ params: { jobId: handle.jobId } }), res);

      const { data } = res.json.firstCall.args[0];
      expect(data.cancelRequested).to.equal(true);
      // The worker has not stopped yet, and the response does not pretend it has.
      expect(data.status).to.equal('Running');
      expect(jobRegistry.isCanceled(handle.jobId)).to.equal(true);
    });

    it('404s a cancel for an unknown job', async () => {
      const controller = build();
      const res = mkRes();

      await controller.cancelOperation(mkReq({ params: { jobId: 'op_nope' } }), res);

      expect(res.status.calledWith(404)).to.equal(true);
    });
  });
});
