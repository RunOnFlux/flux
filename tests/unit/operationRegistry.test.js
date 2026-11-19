const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');

chai.use(chaiAsPromised);
const { expect } = chai;
const operationRegistry = require('../../ZelBack/src/services/utils/operationRegistry');

describe('operationRegistry tests', () => {
  afterEach(() => operationRegistry.clear());

  it('lets one operation hold an app at a time', () => {
    const token = operationRegistry.acquire('app1', 'backup', 'test');

    expect(token).to.be.a('string');
    expect(operationRegistry.acquire('app1', 'restore', 'test')).to.equal(null);
    expect(operationRegistry.acquire('app1', 'backup', 'test')).to.equal(null);
    expect(operationRegistry.get('app1')).to.deep.equal({ type: 'backup', owner: 'test' });
    expect(operationRegistry.acquire('app2', 'restore', 'test')).to.be.a('string');
  });

  it('releases only for the token that took the lease', () => {
    const token = operationRegistry.acquire('app1', 'backup', 'test');

    expect(operationRegistry.release('app1', 'lease-other')).to.equal(false);
    expect(operationRegistry.release('app1', null)).to.equal(false);
    expect(operationRegistry.isHeld('app1')).to.equal(true);
    expect(operationRegistry.release('app1', token)).to.equal(true);
    expect(operationRegistry.isHeld('app1')).to.equal(false);
  });

  it('lists the apps each type holds', () => {
    operationRegistry.acquire('app1', 'backup', 'test');
    operationRegistry.acquire('app2', 'restore', 'test');
    operationRegistry.acquire('app3', 'backup', 'test');

    expect(operationRegistry.listByType('backup')).to.deep.equal(['app1', 'app3']);
    expect(operationRegistry.listByType('restore')).to.deep.equal(['app2']);
  });

  it('stops a holder through its signal, naming what it stops for', () => {
    const token = operationRegistry.acquire('app1', 'backup', 'test');
    const signal = operationRegistry.signalOf('app1', token);

    expect(operationRegistry.signalOf('app1', 'lease-other')).to.equal(null);
    expect(() => operationRegistry.throwIfPreempted(signal)).to.not.throw();
    expect(operationRegistry.preempt('app1', 'removal')).to.equal(true);
    expect(signal.aborted).to.equal(true);
    expect(() => operationRegistry.throwIfPreempted(signal))
      .to.throw(operationRegistry.OperationPreemptedError, 'app1: stopped for its removal');
    expect(operationRegistry.preempt('free', 'removal')).to.equal(false);
  });
  describe('submit', () => {
    const { submit, OperationRefusedError, OperationPreemptedError } = operationRegistry;

    // An operation that holds the app until let go, and settles with `value`.
    function held(key, type, value = type) {
      let letGo;
      const gate = new Promise((resolve) => { letGo = resolve; });
      let op = null;
      const done = submit(key, type, async (current) => {
        op = current;
        await gate;
        return value;
      });
      return {
        done, letGo, op: () => op,
      };
    }
    const turn = () => new Promise((resolve) => { setImmediate(resolve); });
    const a = (type) => (type === 'install' ? `an ${type}` : `a ${type}`);

    ['backup', 'restore', 'control'].forEach((type) => {
      ['install', 'remove', 'redeploy', 'backup', 'restore', 'control'].forEach((holder) => {
        it(`refuses ${a(type)} while ${a(holder)} holds the app`, async () => {
          const holding = held('app1', holder);
          await turn();
          const fn = sinon.spy();

          await expect(submit('app1', type, fn)).to.be.rejectedWith(OperationRefusedError, `Refused: a ${operationRegistry.OPERATION_NAMES[holder]} of app1 is in progress`);
          expect(fn.called).to.equal(false);
          holding.letGo();
          await holding.done;
        });
      });
    });

    it('takes the app in the call, so of two backups asked at once one is refused', async () => {
      const first = submit('app1', 'backup', async () => 'first');
      const second = submit('app1', 'backup', async () => 'second');

      expect(await first).to.equal('first');
      await expect(second).to.be.rejectedWith(OperationRefusedError);
    });

    ['install', 'redeploy', 'backup', 'restore', 'control'].forEach((holder) => {
      it(`stops ${a(holder)} for a removal and removes once it is released`, async () => {
        const holding = held('app1', holder);
        await turn();
        const removing = sinon.spy(async () => 'removed');
        const removal = submit('app1', 'remove', removing);
        await turn();

        expect(holding.op().signal.aborted).to.equal(true);
        expect(() => operationRegistry.throwIfPreempted(holding.op().signal)).to.throw(OperationPreemptedError, 'app1: stopped for its removal');
        expect(removing.called, 'the removal ran while the holder held the app').to.equal(false);
        holding.letGo();
        expect(await removal).to.equal('removed');
        expect(removing.calledOnce).to.equal(true);
      });
    });

    it('gives a removal arriving while one runs that removal\'s outcome', async () => {
      const first = held('app1', 'remove', 'removed once');
      await turn();
      const second = sinon.spy(async () => 'removed twice');
      const joining = submit('app1', 'remove', second);
      first.letGo();

      expect(await joining).to.equal('removed once');
      expect(second.called).to.equal(false);
    });

    it('gives a removal arriving while one waits for the app that removal\'s outcome', async () => {
      const backup = held('app1', 'backup');
      await turn();
      const firstRemoval = sinon.spy(async () => 'removed once');
      const secondRemoval = sinon.spy(async () => 'removed twice');
      const first = submit('app1', 'remove', firstRemoval);
      const second = submit('app1', 'remove', secondRemoval);
      backup.letGo();

      expect(await first).to.equal('removed once');
      expect(await second).to.equal('removed once');
      expect(secondRemoval.called).to.equal(false);
    });

    it('runs a removal of the whole app after a removal of one of its components, never joining it', async () => {
      let letGo;
      const gate = new Promise((resolve) => { letGo = resolve; });
      const component = submit('app1', 'remove', async () => { await gate; return 'component removed'; }, { target: 'web_app1' });
      await turn();
      const whole = sinon.spy(async () => 'app removed');
      const removal = submit('app1', 'remove', whole, { target: 'app1' });
      await turn();

      expect(whole.called, 'the app removal ran beside the component removal').to.equal(false);
      letGo();
      expect(await component).to.equal('component removed');
      expect(await removal).to.equal('app removed');
      expect(whole.calledOnce).to.equal(true);
    });

    ['install', 'redeploy'].forEach((type) => {
      ['backup', 'restore', 'install', 'redeploy', 'control'].forEach((holder) => {
        it(`runs ${a(type)} once ${a(holder)} releases the app`, async () => {
          const holding = held('app1', holder);
          await turn();
          const waits = [];
          const fn = sinon.spy(async () => type);
          const waiting = submit('app1', type, fn, { onWait: (wait) => waits.push(wait) });
          await turn();

          expect(fn.called, `the ${type} ran while the ${holder} held the app`).to.equal(false);
          expect(holding.op().signal.aborted).to.equal(false);
          expect(waits).to.deep.equal([{ holder }]);
          holding.letGo();
          expect(await waiting).to.equal(type);
        });
      });

      it(`refuses ${a(type)} while a removal runs`, async () => {
        const removal = held('app1', 'remove');
        await turn();

        await expect(submit('app1', type, sinon.spy())).to.be.rejectedWith(OperationRefusedError, 'Refused: a removal of app1 is in progress');
        removal.letGo();
        await removal.done;
      });

      it(`refuses ${a(type)} while a removal waits for the app`, async () => {
        const backup = held('app1', 'backup');
        await turn();
        const removal = submit('app1', 'remove', async () => 'removed');

        await expect(submit('app1', type, sinon.spy())).to.be.rejectedWith(OperationRefusedError, 'Refused: a removal of app1 is in progress');
        backup.letGo();
        await removal;
      });

      it(`refuses ${a(type)} already waiting when a removal arrives before it has the app`, async () => {
        const backup = held('app1', 'backup');
        await turn();
        const fn = sinon.spy();
        const waiting = submit('app1', type, fn);
        const removal = submit('app1', 'remove', async () => 'removed');
        backup.letGo();

        await expect(waiting).to.be.rejectedWith(OperationRefusedError, 'Refused: a removal of app1 is in progress');
        expect(fn.called).to.equal(false);
        expect(await removal).to.equal('removed');
      });
    });

    it('runs the newest of two redeploys waiting for the app, and gives both callers its outcome', async () => {
      const backup = held('app1', 'backup');
      await turn();
      const older = sinon.spy(async () => 'older spec');
      const newer = sinon.spy(async () => 'newer spec');
      const first = submit('app1', 'redeploy', older);
      const second = submit('app1', 'redeploy', newer);
      backup.letGo();

      expect(await first).to.equal('newer spec');
      expect(await second).to.equal('newer spec');
      expect(older.called).to.equal(false);
      expect(newer.calledOnce).to.equal(true);
    });

    it('holds a waiting redeploy in its app, so a caller that sends it moves on to the next app', async () => {
      const backup = held('app1', 'backup');
      await turn();
      const waiting = submit('app1', 'redeploy', async () => 'app1 redeployed');

      expect(await submit('app2', 'redeploy', async () => 'app2 redeployed')).to.equal('app2 redeployed');
      backup.letGo();
      expect(await waiting).to.equal('app1 redeployed');
    });

    it('starts a waiting redeploy when a backup holding the app through its lease releases it', async () => {
      const token = operationRegistry.acquire('app1', 'backup', 'test');
      const redeploying = sinon.spy(async () => 'redeployed');
      const waiting = submit('app1', 'redeploy', redeploying);
      await turn();

      expect(redeploying.called).to.equal(false);
      operationRegistry.release('app1', token);
      expect(await waiting).to.equal('redeployed');
    });

    it('runs a removal before an install that was waiting, and refuses the install', async () => {
      const backup = held('app1', 'backup');
      await turn();
      const installing = sinon.spy();
      const install = submit('app1', 'install', installing);
      const removal = submit('app1', 'remove', async () => 'removed');
      backup.letGo();

      await expect(install).to.be.rejectedWith(OperationRefusedError, 'Refused: a removal of app1 is in progress');
      expect(await removal).to.equal('removed');
      expect(installing.called).to.equal(false);
    });

    ['install', 'redeploy'].forEach((type) => {
      it(`refuses ${a(type)} whose caller does not wait while the app is busy, and runs it when the app is free`, async () => {
        const backup = held('app1', 'backup');
        await turn();
        const fn = sinon.spy(async () => type);

        await expect(submit('app1', type, fn, { wait: false })).to.be.rejectedWith(OperationRefusedError, 'Refused: a backup of app1 is in progress');
        expect(fn.called).to.equal(false);
        backup.letGo();
        await backup.done;
        expect(await submit('app1', type, fn, { wait: false })).to.equal(type);
      });
    });

    it('runs a step under the operation it is part of, with its op', async () => {
      const removalStep = sinon.spy(async (op) => op);
      const result = await submit('app1', 'redeploy', async (op) => {
        const stepOp = await submit('app1', 'remove', removalStep, { parent: op });
        return { op, stepOp };
      });

      expect(result.stepOp).to.equal(result.op);
      expect(removalStep.calledOnce).to.equal(true);
    });

    it('refuses a step of an operation that does not hold the app', async () => {
      const outside = { key: 'app1', type: 'redeploy', token: 'lease-none' };

      await expect(submit('app1', 'remove', sinon.spy(), { parent: outside })).to.be.rejectedWith('a remove step of an operation that does not hold the app');
    });

    it('stops a step of an operation a removal has stopped', async () => {
      let parent;
      const holding = submit('app1', 'redeploy', async (op) => {
        parent = op;
        await turn();
        await turn();
        return submit('app1', 'install', sinon.spy(), { parent: op });
      });
      await turn();
      const removal = submit('app1', 'remove', async () => 'removed');

      await expect(holding).to.be.rejectedWith(OperationPreemptedError);
      expect(parent.signal.aborted).to.equal(true);
      expect(await removal).to.equal('removed');
    });

    it('releases the app when the operation throws', async () => {
      await expect(submit('app1', 'redeploy', async () => { throw new Error('pull failed'); })).to.be.rejectedWith('pull failed');

      expect(operationRegistry.isHeld('app1')).to.equal(false);
      expect(await submit('app1', 'backup', async () => 'backed up')).to.equal('backed up');
    });

    it('holds the app however long its operation runs', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
      try {
        const holding = held('app1', 'backup');
        await Promise.resolve();
        clock.tick(7 * 24 * 60 * 60 * 1000);

        expect(operationRegistry.get('app1')).to.deep.include({ type: 'backup' });
        holding.letGo();
        await holding.done;
      } finally {
        clock.restore();
      }
    });

    it('holds one app without holding another', async () => {
      const removal = held('app1', 'remove');
      await turn();

      expect(await submit('app2', 'install', async () => 'installed')).to.equal('installed');
      expect(await submit('app2', 'backup', async () => 'backed up')).to.equal('backed up');
      removal.letGo();
      await removal.done;
    });
  });
});
