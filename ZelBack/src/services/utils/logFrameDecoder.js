/**
 * Docker's log framing, decoded as it arrives rather than all at once.
 *
 * A poll gets one complete payload and can walk it in a loop. A follow stream
 * does not: docker writes when the container writes, and a chunk boundary falls
 * wherever TCP put it - through a header, through a body, between the two. So
 * the frame walk has to survive being interrupted, which means holding what is
 * left over until the rest of it arrives.
 *
 * Two different partials, and both are real. A frame can arrive in pieces, so
 * the byte buffer keeps what is not yet a whole frame. A LINE can also arrive in
 * pieces - docker splits a message longer than 16KB across several frames - so
 * the text buffer keeps what is not yet a whole line. Splitting on '\n' per
 * frame instead would cut those messages into fragments and call each one a log
 * line.
 *
 * Every app container is created with Tty false (appDockerCreate), so every
 * write is framed with an 8-byte header carrying the stream id and length. A
 * Tty container writes raw and would need a different reader; none of ours do.
 */
class LogFrameDecoder {
  constructor() {
    /** Bytes that are not yet a complete frame */
    this.bytes = Buffer.alloc(0);
    /** Text that is not yet a complete line */
    this.partial = '';
  }

  /**
   * The complete lines this chunk finished, in docker's order.
   *
   * @param {Buffer} chunk
   * @returns {string[]}
   */
  push(chunk) {
    this.bytes = this.bytes.length ? Buffer.concat([this.bytes, chunk]) : chunk;

    let offset = 0;
    let text = '';
    while (offset + 8 <= this.bytes.length) {
      const length = this.bytes.readUInt32BE(offset + 4);
      // The body has not all arrived: leave the header with it, so the next
      // chunk resumes at a frame boundary rather than mid-body.
      if (offset + 8 + length > this.bytes.length) break;
      text += this.bytes.toString('utf8', offset + 8, offset + 8 + length);
      offset += 8 + length;
    }
    this.bytes = offset ? this.bytes.subarray(offset) : this.bytes;

    if (!text) return [];

    const lines = (this.partial + text).split('\n');
    // The last element is whatever followed the final newline - empty when the
    // text ended on one, and the start of the next line when it did not.
    this.partial = lines.pop();
    return lines.filter((line) => line.trim());
  }

  /**
   * The line held back because no newline ever followed it, released because the
   * stream ended and none ever will.
   *
   * @returns {string[]}
   */
  flush() {
    const held = this.partial;
    this.partial = '';
    return held.trim() ? [held] : [];
  }
}

module.exports = LogFrameDecoder;
