const { expect } = require('chai');
const fs = require('node:fs');
const path = require('node:path');

// Every `config.fluxapps.x ?? literal` in the service layer is a SECOND copy of a
// value ZelBack/config/default.js already ships. Not one of them is a default the
// module owns - config ships all forty - so the literal protects against nothing
// reachable: app.js pins NODE_CONFIG_DIR to ZelBack/config/, and node-config's
// NODE_CONFIG overlay deep-merges rather than replaces, so the key cannot go
// missing on a node.
//
// What the copy does do is drift. restartBurstWindowMs was widened to 300000 in
// config while the module's literal stayed at 60000, and nothing caught it: the
// unit config supplies every key, so the fallback is never taken under test, and
// the assertions that depend on the value read the constant rather than config.
//
// If a fallback is ever taken, it does not degrade gracefully either -
// `Date.now() - x <= undefined` is false, so a missing burst window turns the
// crash ceiling silently off rather than making it wrong.
//
// The long-term fix is config.get(), which throws by name on a missing key and
// leaves one source of truth. That is 40 call sites here and 108 on the v9
// lineage, so it is its own change. This holds the line until then: drift becomes
// impossible to merge rather than merely impossible to write.
describe('config fallbacks match what config ships', () => {
  const SRC = path.join(__dirname, '../../ZelBack/src');
  // eslint-disable-next-line global-require
  const production = require('../../ZelBack/config/default');

  /**
   * The fallback expression following `??`, ending where the expression does:
   * at a top-level `;` `,` or newline, or at the `)` that closes an enclosing
   * call - `(config.fluxapps.x ?? 300000)` is the common inline shape.
   * @param {string} text
   * @param {number} from index just past the `??`
   * @returns {string}
   */
  function readExpression(text, from) {
    let depth = 0;
    for (let i = from; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '(' || ch === '[') depth += 1;
      else if (ch === ')' || ch === ']') {
        if (depth === 0) return text.slice(from, i);
        depth -= 1;
      } else if (depth === 0 && (ch === ';' || ch === ',' || ch === '\n')) {
        return text.slice(from, i);
      }
    }
    return text.slice(from);
  }

  /**
   * Evaluates a fallback literal. Returns undefined when the expression is not a
   * plain arithmetic or array literal, which the test reports as a failure rather
   * than skipping - a guard that quietly covers half its cases is how the drift it
   * exists to catch got in.
   * @param {string} expr
   * @returns {number|Array|undefined}
   */
  function evaluate(expr) {
    const trimmed = expr.trim();
    if (!/^[\d\s*+\-()[\],.]+$/.test(trimmed)) return undefined;
    // The input is this repository's own source, read from disk, matched against
    // a digits-and-operators whitelist above.
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${trimmed});`)();
  }

  function jsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return jsFiles(full);
      return entry.name.endsWith('.js') ? [full] : [];
    });
  }

  const found = [];
  jsFiles(SRC).forEach((file) => {
    const text = fs.readFileSync(file, 'utf8');
    const pattern = /config\.fluxapps\.([a-zA-Z0-9_]+)\s*\?\?/g;
    let match = pattern.exec(text);
    while (match) {
      found.push({
        key: match[1],
        expr: readExpression(text, match.index + match[0].length),
        file: path.relative(SRC, file),
        line: text.slice(0, match.index).split('\n').length,
      });
      match = pattern.exec(text);
    }
  });

  it('finds the fallbacks at all, so an empty sweep cannot pass every assertion below', () => {
    expect(found.length).to.be.greaterThan(30);
  });

  found.forEach(({ key, expr, file, line }) => {
    it(`${key} (${file}:${line}) falls back to the value config ships`, () => {
      const shipped = production.fluxapps[key];
      expect(shipped, `config/default.js ships no fluxapps.${key}, so the literal is the only definition - either ship it or drop the fallback`).to.not.equal(undefined);

      const fallback = evaluate(expr);
      expect(fallback, `the fallback for ${key} is not a plain literal (${expr.trim()}), so this guard cannot compare it - make it one, or the drift it exists to catch can hide here`).to.not.equal(undefined);

      expect(fallback).to.deep.equal(shipped);
    });
  });
});
