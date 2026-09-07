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
  // Docker stamps a message once and copies that stamp onto every 16KB chunk it
  // splits the message into - measured on a live daemon, three chunks of
  // len=16415 (16384 and a 31-character stamp) all carrying the first one's.
  const STAMP = '2026-09-07T20:29:23.578815058Z';

  it('joins the pieces of one line without the stamps docker put on each of them', () => {
    // Joined as they arrive, a line over 16KB comes back with docker's stamps
    // spliced through its body - a line the container never wrote, and one a
    // reader cannot tell from one it did.
    const decoder = new LogFrameDecoder({ timestamped: true });

    expect(decoder.push(frame(`${STAMP} {"user":"alice",`))).to.deep.equal([]);
    expect(decoder.push(frame(`${STAMP} "data":[1,2,3],`))).to.deep.equal([]);
    expect(decoder.push(frame(`${STAMP} "ok":true}\n`))).to.deep.equal([
      `${STAMP} {"user":"alice","data":[1,2,3],"ok":true}`,
    ]);
  });

  it('keeps the stamp of a line that is starting, not continuing one', () => {
    const decoder = new LogFrameDecoder({ timestamped: true });
    const later = '2026-09-07T20:29:23.586281204Z';

    expect(decoder.push(frame(`${STAMP} first\n${later} second\n`))).to.deep.equal([
      `${STAMP} first`,
      `${later} second`,
    ]);
  });

  it('leaves a continuation alone when what leads it is not this line\'s stamp', () => {
    // Compared rather than matched by shape. Content that merely looks like a
    // timestamp belongs to the container, and if docker ever stops repeating the
    // stamp the body has to pass through exactly as it arrived.
    const decoder = new LogFrameDecoder({ timestamped: true });
    const other = '2026-09-07T20:29:23.586281204Z';

    decoder.push(frame(`${STAMP} held-`));
    expect(decoder.push(frame(`${other} kept\n`))).to.deep.equal([
      `${STAMP} held-${other} kept`,
    ]);
  });

  it('strips nothing at all unless the caller asked docker for timestamps', () => {
    const decoder = new LogFrameDecoder();

    decoder.push(frame(`${STAMP} held-`));
    expect(decoder.push(frame(`${STAMP} more\n`))).to.deep.equal([
      `${STAMP} held-${STAMP} more`,
    ]);
  });

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

  it('holds a line without limit unless it is given one', () => {
    // The default is what the polling read wants: it is handed one payload and
    // is bounded by it, so a cap there would cut a line the caller asked for.
    const decoder = new LogFrameDecoder();

    expect(decoder.push(frame('x'.repeat(70000)))).to.deep.equal([]);
    expect(decoder.partial.length, 'the default decoder cut a line').to.equal(70000);
    expect(decoder.takeTruncated()).to.equal(0);
  });

  it('hands over a line too long to hold, cut, and counts what it cut once the line ends', () => {
    // A line is held until its newline arrives and nothing obliges a container
    // to send one. Unbounded, a process writing a large blob to stdout decides
    // how much of the node's memory a viewer costs - and then how much crosses
    // the socket, because a line that completes is delivered whole.
    //
    // How much was cut is not known until the line ends, so it is not reported
    // until then: a reader told what had been discarded SO FAR would be told
    // again for every batch until the newline came, for the one cut line.
    const decoder = new LogFrameDecoder({ maxLineLength: 10 });

    expect(decoder.push(frame('0123456789ABCDE'))).to.deep.equal(['0123456789']);
    expect(decoder.partial, 'the tail was held rather than dropped').to.equal('');
    expect(decoder.takeTruncated(), 'counted before the line it belongs to had ended').to.equal(0);

    expect(decoder.push(frame('FGHIJ')), 'the tail arrived as a line of its own').to.deep.equal([]);
    expect(decoder.takeTruncated(), 'counted while the line was still arriving').to.equal(0);

    expect(decoder.push(frame('\n'))).to.deep.equal([]);
    expect(decoder.takeTruncated(), 'ABCDE and FGHIJ, counted once the line ended').to.equal(10);
    expect(decoder.takeTruncated(), 'a discard was reported twice').to.equal(0);
  });

  it('counts what it cut when the stream ends mid-discard, since no newline is coming', () => {
    const decoder = new LogFrameDecoder({ maxLineLength: 10 });

    decoder.push(frame('0123456789ABCDE'));
    expect(decoder.flush()).to.deep.equal([]);
    expect(decoder.takeTruncated(), 'the discard went unreported with the stream').to.equal(5);
  });

  it('cuts a line whose newline arrived in the same chunk', () => {
    // That line never passed through the held tail, so a decoder that bounded
    // only the tail would hand it over whole - and what a viewer is sent would
    // depend on where the stream happened to chunk.
    const decoder = new LogFrameDecoder({ maxLineLength: 10 });

    expect(decoder.push(frame('0123456789ABCDE\nshort\n'))).to.deep.equal(['0123456789', 'short']);
    expect(decoder.takeTruncated()).to.equal(5);
    expect(decoder.discarding, 'a line that ended was treated as one still arriving').to.be.false;
  });

  it('drops the rest of a cut line rather than splitting it into more lines', () => {
    // The alternative is handing a viewer a run of lines the container never
    // wrote, which bounds the memory and not the delivery.
    const decoder = new LogFrameDecoder({ maxLineLength: 10 });

    decoder.push(frame('0123456789ABCDE'));
    expect(decoder.push(frame('FGHIJ')), 'the tail arrived as a line of its own').to.deep.equal([]);
    expect(decoder.push(frame('KL\nnext-line\n')), 'the line after it was lost with the tail').to.deep.equal(['next-line']);
    expect(decoder.takeTruncated(), 'every discarded character is counted').to.equal(12);
  });

  it('leaves a long line alone when it fits', () => {
    const decoder = new LogFrameDecoder({ maxLineLength: 10 });

    expect(decoder.push(frame('0123456789\n'))).to.deep.equal(['0123456789']);
    expect(decoder.takeTruncated(), 'a line exactly at the limit was cut').to.equal(0);
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
