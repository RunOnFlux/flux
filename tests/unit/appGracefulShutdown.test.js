const chai = require('chai');

const { expect } = chai;
const appGracefulShutdown = require('../../ZelBack/src/services/appLifecycle/appGracefulShutdown');

describe('appGracefulShutdown tests', () => {
  describe('parseGracefulShutdownSec', () => {
    it('returns null for non-string / empty input', () => {
      expect(appGracefulShutdown.parseGracefulShutdownSec(undefined)).to.equal(null);
      expect(appGracefulShutdown.parseGracefulShutdownSec(null)).to.equal(null);
      expect(appGracefulShutdown.parseGracefulShutdownSec(123)).to.equal(null);
      expect(appGracefulShutdown.parseGracefulShutdownSec('')).to.equal(null);
    });

    it('returns null when the token is absent', () => {
      expect(appGracefulShutdown.parseGracefulShutdownSec('a normal app description')).to.equal(null);
    });

    it('parses gracefulShutdownSec:<n>', () => {
      expect(appGracefulShutdown.parseGracefulShutdownSec('gracefulShutdownSec:300')).to.equal(300);
    });

    it('parses the token when embedded in prose', () => {
      expect(appGracefulShutdown.parseGracefulShutdownSec('api tier; gracefulShutdownSec:45 thanks')).to.equal(45);
    });

    it('is case-insensitive and accepts = and surrounding whitespace', () => {
      expect(appGracefulShutdown.parseGracefulShutdownSec('GRACEFULSHUTDOWNSEC = 60')).to.equal(60);
      expect(appGracefulShutdown.parseGracefulShutdownSec('gracefulshutdownsec:  90')).to.equal(90);
    });

    it('clamps to MAX_SECONDS (6h)', () => {
      expect(appGracefulShutdown.parseGracefulShutdownSec('gracefulShutdownSec:99999')).to.equal(appGracefulShutdown.MAX_SECONDS);
      expect(appGracefulShutdown.MAX_SECONDS).to.equal(21600);
    });

    it('returns null for zero / below the minimum', () => {
      expect(appGracefulShutdown.parseGracefulShutdownSec('gracefulShutdownSec:0')).to.equal(null);
    });

    it('returns null for a malformed (non-numeric / empty) value', () => {
      expect(appGracefulShutdown.parseGracefulShutdownSec('gracefulShutdownSec:abc')).to.equal(null);
      expect(appGracefulShutdown.parseGracefulShutdownSec('gracefulShutdownSec:')).to.equal(null);
      expect(appGracefulShutdown.parseGracefulShutdownSec('gracefulShutdownSec:300abc')).to.equal(null);
    });

    it('does not match a longer adjacent key (word boundary)', () => {
      expect(appGracefulShutdown.parseGracefulShutdownSec('mygracefulShutdownSec:300')).to.equal(null);
    });
  });
});
