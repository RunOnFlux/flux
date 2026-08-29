// Every privilege check in the tree, read from the sources.
//
// The suite cannot cover this: verifyPrivilege is stubbed at 43 test files and
// almost none of them inspect what it was called with, so a call site wired
// wrongly is green everywhere. A miswired site does not crash either - it
// answers false, which reaches a caller as an ordinary 401 and stays there.
//
// So the guarantee is taken statically instead, over the real source, where it
// is exhaustive rather than sampled. Anything this cannot classify is a failure,
// not a skip: a sweep that silently drops what it cannot resolve reports the
// assumptions it was built from rather than the state of the code.

const fs = require('node:fs');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const { expect } = require('chai');
const espree = require('espree');

const { Privilege, APP_SCOPED } = require('../../ZelBack/src/services/utils/privileges');

const ROOT = nodePath.join(__dirname, '../..');
const MEMBERS = new Set(Object.keys(Privilege));
const SCOPED = new Set(Object.entries(Privilege).filter(([, v]) => APP_SCOPED.includes(v)).map(([k]) => k));

const sourceFiles = () => execFileSync('git', ['-C', ROOT, 'ls-files', 'ZelBack/src'], { encoding: 'utf8' })
  .split('\n').filter((f) => f.endsWith('.js'));

function callSites() {
  const sites = [];
  for (const rel of sourceFiles()) {
    const src = fs.readFileSync(nodePath.join(ROOT, rel), 'utf8');
    if (!src.includes('verifyPrivilege(')) continue;
    const ast = espree.parse(src, { ecmaVersion: 2022, sourceType: 'script', loc: true, range: true });
    const text = (node) => src.slice(node.range[0], node.range[1]);
    (function walk(node) {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'CallExpression'
          && node.callee.type === 'MemberExpression'
          && node.callee.property.name === 'verifyPrivilege') {
        sites.push({ where: `${rel}:${node.loc.start.line}`, args: node.arguments, text });
      }
      for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'range') continue;
        const value = node[key];
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value.type === 'string') walk(value);
      }
    }(ast));
  }
  return sites;
}

describe('privilege call shape', () => {
  const sites = callSites();

  it('finds every call site, and there are as many as the tree has', () => {
    // A number, so this fails loudly if the sweep silently stops finding them.
    expect(sites.length).to.be.greaterThan(250);
  });

  it('names a privilege by its member, never by the string behind it', () => {
    const wrong = sites.filter(({ args, text }) => {
      const first = args[0];
      if (first.type === 'MemberExpression' && first.object.name === 'Privilege') return !MEMBERS.has(first.property.name);
      // one site takes the privilege from its own options default, which is a
      // member; anything else naming a privilege inline is what this forbids
      return !(first.type === 'Identifier' && text(first) === 'privilege');
    }).map(({ where, args, text }) => `${where}  ${text(args[0])}`);
    expect(wrong).to.deep.equal([]);
  });

  it('hands over the auth a request carries, never the request', () => {
    const wrong = sites.filter(({ args, text }) => {
      const second = text(args[1]);
      return !/^authOf\((req|request)\)$/.test(second) && second !== 'zelidauth' && second !== 'authDetails';
    }).map(({ where, args, text }) => `${where}  ${text(args[1])}`);
    expect(wrong).to.deep.equal([]);
  });

  it('carries an app name only as { appName }, and only where one is read', () => {
    const wrong = [];
    sites.forEach(({ where, args, text }) => {
      const first = args[0];
      const member = first.type === 'MemberExpression' ? first.property.name : null;
      const third = args[2];
      if (third && third.type !== 'ObjectExpression') wrong.push(`${where}  third argument is ${text(third)}`);
      if (member && !SCOPED.has(member) && third) wrong.push(`${where}  ${member} reads no app name`);
      if (member && SCOPED.has(member) && !third) wrong.push(`${where}  ${member} needs an app name`);
    });
    expect(wrong).to.deep.equal([]);
  });

  it('never makes the check conditional on an argument being present', () => {
    // `res ? await verifyPrivilege(...) : true` and `if (req) { ...check... }`
    // both decide whether to authorise from whether a caller passed something,
    // so a caller who passes nothing is trusted. A handler that serves requests
    // checks; an operation with no caller to check does not exist as a request
    // handler at all.
    const offenders = [];
    sourceFiles().forEach((rel) => {
      const src = fs.readFileSync(nodePath.join(ROOT, rel), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/res \? await verificationHelper/.test(line)) offenders.push(`${rel}:${i + 1} conditional on res`);
        if (/^\s*if \(req\) \{/.test(line) && /verifyPrivilege/.test(src)) offenders.push(`${rel}:${i + 1} conditional on req`);
      });
    });
    expect(offenders).to.deep.equal([]);
  });

  it('leaves nobody reaching a verifier behind verifyPrivilege\'s back', () => {
    // The container terminal did exactly this, and so carried no privilege for a
    // search to find. The helper itself is the one place allowed to.
    const reaching = sourceFiles().filter((rel) => {
      if (rel.endsWith('verificationHelper.js')) return false;
      const src = fs.readFileSync(nodePath.join(ROOT, rel), 'utf8');
      return /verificationHelperUtils\.verify\w*Session\(/.test(src);
    });
    expect(reaching).to.deep.equal([]);
  });
});
