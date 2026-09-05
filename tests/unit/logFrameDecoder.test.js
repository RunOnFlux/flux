const { expect } = require('chai');

const LogFrameDecoder = require('../../ZelBack/src/services/utils/logFrameDecoder');

/**
 * A docker log frame: 8-byte header carrying the stream id and a big-endian
 * body length, then the body.
 */
function frame(text, streamId = 1) {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt8(streamId, 0);
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

describe('logFrameDecoder', () => {
  it('returns the lines a whole frame completes', () => {
    const decoder = new LogFrameDecoder();

    expect(decoder.push(frame('one\ntwo\n'))).to.deep.equal(['one', 'two']);
  });

  it('holds a frame split across chunks until the rest arrives', () => {
    // A follow stream is chunked wherever TCP put the boundary, not on frame
    // edges. Reading the length from a half-arrived header is the failure this
    // exists to prevent.
    const decoder = new LogFrameDecoder();
    const whole = frame('hello\n');

    expect(decoder.push(whole.subarray(0, 3)), 'a partial header is not a frame').to.deep.equal([]);
    expect(decoder.push(whole.subarray(3, 10)), 'a partial body is not a frame').to.deep.equal([]);
    expect(decoder.push(whole.subarray(10))).to.deep.equal(['hello']);
  });

  it('joins a line that spans several frames', () => {
    // Docker splits a message longer than 16KB across frames. Splitting on '\n'
    // per frame would call each piece a log line.
    const decoder = new LogFrameDecoder();

    expect(decoder.push(frame('start-')).length, 'no newline yet, so no line yet').to.equal(0);
    expect(decoder.push(frame('middle-'))).to.deep.equal([]);
    expect(decoder.push(frame('end\n'))).to.deep.equal(['start-middle-end']);
  });

  it('keeps a trailing partial line back until its newline arrives', () => {
    const decoder = new LogFrameDecoder();

    expect(decoder.push(frame('done\nnot-yet'))).to.deep.equal(['done']);
    expect(decoder.push(frame('-now\n'))).to.deep.equal(['not-yet-now']);
  });

  it('releases the held line when the stream ends without a newline', () => {
    const decoder = new LogFrameDecoder();
    decoder.push(frame('last-line-no-newline'));

    expect(decoder.flush()).to.deep.equal(['last-line-no-newline']);
    expect(decoder.flush(), 'flushing twice does not repeat it').to.deep.equal([]);
  });

  it('reads stdout and stderr frames alike', () => {
    // Both streams are framed identically and interleaved in one connection;
    // the stream id names which, and neither is dropped.
    const decoder = new LogFrameDecoder();

    expect(decoder.push(Buffer.concat([frame('out\n', 1), frame('err\n', 2)])))
      .to.deep.equal(['out', 'err']);
  });

  it('drops blank lines rather than reporting them as log lines', () => {
    const decoder = new LogFrameDecoder();

    expect(decoder.push(frame('a\n\n  \nb\n'))).to.deep.equal(['a', 'b']);
  });

  it('reads several frames delivered in one chunk', () => {
    const decoder = new LogFrameDecoder();
    const chunk = Buffer.concat([frame('one\n'), frame('two\n'), frame('three\n')]);

    expect(decoder.push(chunk)).to.deep.equal(['one', 'two', 'three']);
  });

  it('reads a body carrying multibyte characters that a chunk boundary splits', () => {
    // toString on a partial UTF-8 sequence produces a replacement character, so
    // the body has to be complete before it is decoded - which it is, because a
    // frame is held until all of its length has arrived.
    const decoder = new LogFrameDecoder();
    const whole = frame('héllo→\n');

    expect(decoder.push(whole.subarray(0, 11))).to.deep.equal([]);
    expect(decoder.push(whole.subarray(11))).to.deep.equal(['héllo→']);
  });
});
