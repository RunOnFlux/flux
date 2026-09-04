process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const logCursor = require('../../ZelBack/src/services/utils/logCursor');

describe('logCursor tests', () => {
  it('round-trips a position', () => {
    const token = logCursor.encode({ ms: 1788508223926, count: 4 });

    expect(logCursor.decode(token)).to.deep.equal({ ms: 1788508223926, count: 4 });
  });

  it('is opaque, so the shape can change without every reader changing', () => {
    const token = logCursor.encode({ ms: 1788508223926, count: 4 });

    expect(token, 'a reader that parses this becomes a compatibility constraint').to.not.include('1788508223926');
  });

  // A reader with no usable position is a reader at the start, which is answered
  // the same as a first request. Refusing would take a log view down over a
  // cursor a browser kept from an older node.
  it('treats anything it did not issue as no position at all', () => {
    ['', null, undefined, 'not-base64!!', Buffer.from('{}').toString('base64url'),
      Buffer.from('{"v":2,"ms":1,"count":0}').toString('base64url'),
      Buffer.from('{"v":1,"ms":-1,"count":0}').toString('base64url'),
      Buffer.from('{"v":1,"ms":1,"count":1.5}').toString('base64url'),
    ].forEach((token) => {
      expect(logCursor.decode(token), `${token} should not decode`).to.equal(null);
    });
  });
});
