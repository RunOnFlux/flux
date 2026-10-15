const fsPromises = require('node:fs/promises');
const chai = require('chai');
const sinon = require('sinon');

const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const { Privilege } = require('../../ZelBack/src/services/utils/privileges');
const kernelService = require('../../ZelBack/src/services/kernelService');

const { expect } = chai;

const letters = (flags) => flags.map((flag) => flag.letter);

describe('kernelService tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('TAINT_FLAGS', () => {
    it('defines each of the kernel\'s twenty bits once, each with its own letter', () => {
      expect(kernelService.TAINT_FLAGS.map((flag) => flag.bit)).to.eql([...Array(20).keys()]);
      expect(new Set(letters(kernelService.TAINT_FLAGS)).size).to.equal(20);
    });
  });

  describe('decodeTaint', () => {
    it('names an oopsed kernel with a warning and an out-of-tree module', () => {
      expect(letters(kernelService.decodeTaint(4736))).to.eql(['D', 'W', 'O']);
    });

    it('names a soft lockup', () => {
      expect(letters(kernelService.decodeTaint(20480))).to.eql(['O', 'L']);
    });

    it('names nothing for an untainted kernel', () => {
      expect(kernelService.decodeTaint(0)).to.eql([]);
    });

    it('reports a set bit the table does not define rather than dropping it', () => {
      expect(kernelService.decodeTaint((2 ** 20) + 4096)).to.eql([
        { bit: 12, letter: 'O', description: 'Externally-built ("out-of-tree") module was loaded' },
        { bit: 20, letter: null, description: null },
      ]);
    });
  });

  describe('readTaint', () => {
    it('reads the value procfs gives', async () => {
      const read = sinon.stub(fsPromises, 'readFile').resolves('4736\n');

      const record = await kernelService.readTaint();

      sinon.assert.calledWith(read, kernelService.TAINTED_PATH, 'utf8');
      expect(record.tainted).to.equal(4736);
      expect(letters(record.flags)).to.eql(['D', 'W', 'O']);
      expect(Date.parse(record.readAt)).to.be.a('number').and.not.NaN;
    });

    it('reads an unreadable value as unknown, not untainted', async () => {
      sinon.stub(fsPromises, 'readFile').rejects(Object.assign(new Error('no such file'), { code: 'ENOENT' }));

      const record = await kernelService.readTaint();

      expect(record.tainted).to.equal(null);
      expect(record.flags).to.equal(null);
    });

    it('reads a value that does not parse as unknown', async () => {
      sinon.stub(fsPromises, 'readFile').resolves('-1\n');

      const record = await kernelService.readTaint();

      expect(record.tainted).to.equal(null);
      expect(record.flags).to.equal(null);
    });
  });

  describe('getTaintSummary', () => {
    it('carries the value and its letters', async () => {
      sinon.stub(fsPromises, 'readFile').resolves('4736\n');

      expect(await kernelService.getTaintSummary()).to.eql({ tainted: 4736, flags: ['D', 'W', 'O'] });
    });

    it('marks a bit the table does not define', async () => {
      sinon.stub(fsPromises, 'readFile').resolves(`${(2 ** 20) + 4096}\n`);

      expect(await kernelService.getTaintSummary()).to.eql({ tainted: (2 ** 20) + 4096, flags: ['O', '?'] });
    });

    it('carries unknown as unknown', async () => {
      sinon.stub(fsPromises, 'readFile').rejects(new Error('no such file'));

      expect(await kernelService.getTaintSummary()).to.eql({ tainted: null, flags: null });
    });
  });

  describe('kernelAPI', () => {
    function fakeRes() {
      return { json: sinon.stub().returnsArg(0) };
    }

    it('refuses a caller who is neither the node operator nor the Flux team', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      const read = sinon.stub(fsPromises, 'readFile').resolves('4736\n');
      const res = fakeRes();

      await kernelService.kernelAPI({ headers: {} }, res);

      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.code).to.equal(401);
      sinon.assert.notCalled(read);
    });

    it('gives each flag\'s bit, letter and description to the node operator or the Flux team', async () => {
      const verify = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(fsPromises, 'readFile').resolves('4736\n');
      const res = fakeRes();

      await kernelService.kernelAPI({ headers: {} }, res);

      sinon.assert.calledWith(verify, Privilege.NODE_OPERATOR_OR_FLUX_TEAM);
      const answer = res.json.firstCall.args[0];
      expect(answer.status).to.equal('success');
      expect(answer.data.tainted).to.equal(4736);
      expect(answer.data.flags).to.eql(kernelService.decodeTaint(4736));
    });
  });
});
