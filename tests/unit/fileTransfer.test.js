const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const fsPromises = require('fs').promises;
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');

chai.use(chaiAsPromised);
const { expect } = chai;

const { sendFile } = require('../../ZelBack/src/services/utils/fileTransfer');

describe('fileTransfer tests', () => {
  let directory;
  let res;
  let body;
  let written;

  // Enough of an express response to see what was sent and what was declared.
  const makeResponse = () => {
    const sink = new PassThrough();
    sink.attachment = sinon.stub();
    sink.setHeader = sinon.stub();
    sink.destroy = sinon.spy(sink, 'destroy');
    return sink;
  };

  const collected = (response) => new Promise((resolve) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve(Buffer.concat(chunks)));
    response.on('close', () => resolve(Buffer.concat(chunks)));
  });

  const header = (name) => {
    const call = res.setHeader.getCalls().find((each) => each.args[0] === name);
    return call ? call.args[1] : undefined;
  };

  beforeEach(async () => {
    directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'flux-transfer-'));
    res = makeResponse();
    written = [];
    res.on('data', (chunk) => written.push(chunk));
    body = collected(res);
  });

  afterEach(async () => {
    sinon.restore();
    await fsPromises.rm(directory, { recursive: true, force: true });
  });

  it('sends the file, and declares the length it measured', async () => {
    const file = path.join(directory, 'report.txt');
    await fsPromises.writeFile(file, 'the contents');

    await sendFile(res, file, 'report.txt');

    expect((await body).toString()).to.equal('the contents');
    expect(res.attachment.calledWith('report.txt')).to.equal(true);
    expect(header('Content-Length')).to.equal(String('the contents'.length));
  });

  it('sends an empty file as an empty body with a length of zero', async () => {
    const file = path.join(directory, 'empty.txt');
    await fsPromises.writeFile(file, '');

    await sendFile(res, file, 'empty.txt');

    expect((await body).length).to.equal(0);
    expect(header('Content-Length')).to.equal('0');
  });

  // The path was checked before this is called, and the application owns the
  // volume - it can replace what the name refers to in between. Opening refuses
  // to follow a link at the final component, so the swap that turns a checked
  // path into somebody else's file cannot be completed.
  it('refuses a name that has become a symlink since it was checked', async () => {
    const secret = path.join(directory, 'secret');
    await fsPromises.writeFile(secret, 'not yours');
    const swapped = path.join(directory, 'download.txt');
    await fsPromises.symlink(secret, swapped);

    await expect(sendFile(res, swapped, 'download.txt')).to.be.rejected;
    // Not awaited: a refusal pipes nothing, so the response never ends. What
    // matters is that no byte of the file behind the link was written.
    expect(written.length, 'bytes were sent from behind the link').to.equal(0);
  });

  it('refuses anything that is not a regular file', async () => {
    const folder = path.join(directory, 'a-directory');
    await fsPromises.mkdir(folder);

    await expect(sendFile(res, folder, 'a-directory')).to.be.rejectedWith(/regular file/);
  });

  it('refuses a name that is not there at all', async () => {
    await expect(sendFile(res, path.join(directory, 'missing'), 'missing')).to.be.rejected;
  });

  // The application keeps writing to its own volume throughout. A file that
  // grows during the transfer would otherwise produce a body longer than the
  // Content-Length already announced, which a client reads as corruption.
  it('sends no more than the length it declared, however the file grows', async () => {
    const file = path.join(directory, 'growing.bin');
    await fsPromises.writeFile(file, 'x'.repeat(1000));

    const sending = sendFile(res, file, 'growing.bin');
    await fsPromises.appendFile(file, 'y'.repeat(5000));
    await sending;

    const sent = await body;
    expect(header('Content-Length')).to.equal('1000');
    expect(sent.length, 'the body outran the declared length').to.equal(1000);
    expect(sent.toString()).to.equal('x'.repeat(1000));
  });

  it('leaves no descriptor open behind it', async () => {
    const file = path.join(directory, 'report.txt');
    await fsPromises.writeFile(file, 'the contents');

    const before = process.report ? process.report.getReport().libuv.length : null;
    await sendFile(res, file, 'report.txt');
    await body;
    // Settle whatever the stream teardown scheduled.
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    if (before !== null) {
      const after = process.report.getReport().libuv.length;
      expect(after).to.be.at.most(before);
    }
  });

  it('does not advertise a range it cannot serve', async () => {
    const file = path.join(directory, 'report.txt');
    await fsPromises.writeFile(file, 'the contents');

    await sendFile(res, file, 'report.txt');

    expect(header('Accept-Ranges')).to.equal('none');
  });

});
