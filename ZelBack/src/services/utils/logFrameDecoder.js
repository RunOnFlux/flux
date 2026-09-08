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
/**
 * The most of one line a bounded decoder will hold and hand over.
 *
 * A line is held until its newline arrives and nothing obliges a container to
 * send one, so an unbounded decoder lets a process writing a large blob to
 * stdout decide how much of the node's memory a viewer costs - and then how much
 * of it crosses the socket, because a line that finally completes is delivered
 * whole. A megabyte is far past anything a log pane renders and far past what
 * any reader of this is looking for; docker's own framing splits a message at
 * 16KB, so this is sixty-four of those.
 */
const MAX_LINE_LENGTH = 1024 * 1024;

class LogFrameDecoder {
  /**
   * @param {{maxLineLength?: number, timestamped?: boolean}} options
   *   `maxLineLength` truncates a line longer than it and discards the rest of
   *   that line. Unbounded by default: a read that returns one payload is
   *   already bounded by the payload, and it is the FOLLOW stream - which lives
   *   for as long as a viewer watches - that has nothing else to bound it.
   *
   *   `timestamped` says the caller asked docker for timestamps, which is what
   *   makes every frame body begin with one. Declared rather than detected: what
   *   a body holds is the caller's request to docker, not something to infer
   *   from the bytes.
   */
  constructor(options = {}) {
    /** Bytes that are not yet a complete frame */
    this.bytes = Buffer.alloc(0);
    /** Text that is not yet a complete line */
    this.partial = '';
    /** Characters discarded from lines that have ENDED, since last taken */
    this.truncated = 0;
    this.maxLineLength = options.maxLineLength ?? Infinity;
    this.timestamped = options.timestamped ?? false;
    // The tail of a line already handed over truncated. Everything up to its
    // newline is counted and dropped, so one absurd line costs the cap once
    // rather than arriving as a run of invented lines.
    this.discarding = false;
  }

  // What has been cut from the line still arriving. Held rather than reported,
  // because how much was cut from a line is not known until the line ends: a
  // reader told what had been discarded so far would be told again on every
  // batch until the newline came, dozens of times over, for one cut line.
  #discarded = 0;

  // The stamp docker put on the frame that began the line being assembled.
  //
  // A message longer than 16KB is split into 16KB chunks and EVERY chunk is
  // given the message's stamp - measured on a live daemon: three chunks of
  // `len=16415`, which is 16384 and a 31-character stamp, all three carrying the
  // stamp of the first. Joined as they arrive, a line over 16KB comes back with
  // docker's timestamps spliced through its body every 16KB, which is a line the
  // container never wrote and a reader cannot tell from one it did.
  #lineStamp = null;

  /**
   * The line is over, so what was cut from it is now the whole of what was cut.
   *
   * @returns {void}
   */
  #settle() {
    this.truncated += this.#discarded;
    this.#discarded = 0;
  }

  /**
   * How much has been discarded since this was last asked, and zero afterwards.
   *
   * Drained rather than read, so a caller reports each discard once however
   * often it asks.
   *
   * @returns {number} characters
   */
  takeTruncated() {
    const held = this.truncated;
    this.truncated = 0;
    return held;
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
    // Whether what has been read so far ends mid-line, which is what makes the
    // NEXT frame a continuation of one rather than the start of another. Taken
    // from the state this push begins in: a held partial, or a line whose tail
    // is being discarded.
    let continuing = this.partial !== '' || this.discarding;
    while (offset + 8 <= this.bytes.length) {
      const length = this.bytes.readUInt32BE(offset + 4);
      // The body has not all arrived: leave the header with it, so the next
      // chunk resumes at a frame boundary rather than mid-body.
      if (offset + 8 + length > this.bytes.length) break;
      let body = this.bytes.toString('utf8', offset + 8, offset + 8 + length);
      if (this.timestamped) body = this.#ownStamp(body, continuing);
      text += body;
      continuing = !body.endsWith('\n');
      offset += 8 + length;
    }
    this.bytes = offset ? this.bytes.subarray(offset) : this.bytes;

    if (!text) return [];

    if (this.discarding) {
      const ends = text.indexOf('\n');
      if (ends === -1) {
        this.#discarded += text.length;
        return [];
      }
      this.#discarded += ends;
      this.discarding = false;
      this.#settle();
      text = text.slice(ends + 1);
      if (!text) return [];
    }

    const lines = (this.partial + text).split('\n');
    // The last element is whatever followed the final newline - empty when the
    // text ended on one, and the start of the next line when it did not.
    this.partial = lines.pop();

    // Every line handed over is cut, not only the tail below: a line whose
    // newline arrived inside this chunk never passed through `partial`, so
    // bounding the tail alone would leave what a viewer is sent at the mercy of
    // where the stream happened to chunk.
    const cut = [];
    for (let i = 0; i < lines.length; i += 1) {
      cut.push(this.#cut(lines[i]));
      // Its newline has arrived, so nothing more can be cut from this one.
      this.#settle();
    }

    // The tail has no newline yet and may never get one, so it is handed over
    // now and the REST of that line dropped - rather than held for a newline
    // that is not coming, or split into a run of lines the container never
    // wrote. It goes last because it is the tail of this chunk.
    if (this.partial.length > this.maxLineLength) {
      cut.push(this.#cut(this.partial));
      this.partial = '';
      this.discarding = true;
    }

    return cut.filter((line) => line.trim());
  }

  /**
   * The body with only the stamp that belongs to it.
   *
   * The one that begins a line is the line's own and is kept. The one on a
   * continuation is docker's copy of it, and is dropped - but only when it is
   * byte-identical to the stamp this line began with. Compared rather than
   * matched by shape: content that merely looks like a timestamp is not this
   * line's, and if docker ever stops repeating the stamp the comparison fails
   * and the body is passed through exactly as it arrived.
   *
   * @param {string} body
   * @param {boolean} continuing whether this frame continues the line before it
   * @returns {string}
   */
  #ownStamp(body, continuing) {
    if (!continuing) {
      const ends = body.indexOf(' ');
      this.#lineStamp = ends === -1 ? null : body.slice(0, ends);
      return body;
    }
    if (this.#lineStamp && body.startsWith(`${this.#lineStamp} `)) {
      return body.slice(this.#lineStamp.length + 1);
    }
    return body;
  }

  /**
   * A line no longer than this decoder holds, and what it cost counted.
   *
   * @param {string} line
   * @returns {string}
   */
  #cut(line) {
    if (line.length <= this.maxLineLength) return line;
    this.#discarded += line.length - this.maxLineLength;
    return line.slice(0, this.maxLineLength);
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
    this.discarding = false;
    // The stream ended mid-discard, so the newline that would have settled what
    // was cut is not coming.
    this.#settle();
    return held.trim() ? [held] : [];
  }
}

module.exports = LogFrameDecoder;
module.exports.MAX_LINE_LENGTH = MAX_LINE_LENGTH;
