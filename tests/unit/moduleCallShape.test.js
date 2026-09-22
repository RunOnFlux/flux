// Every call one service makes on another names something that module exports.
//
// A member that is not exported is `undefined`, so the call is a TypeError at
// the moment it runs and not before. A unit suite does not see it: the caller
// is proxyquired against a stub that has the member, and the stub is written
// from the same belief as the call. Both agree, both are wrong, and the suite
// is green over a path that throws on every node.
//
// That is not hypothetical. `volumeService` called `appsRuntimeState.setFields`,
// which is internal to that module - the unit suite stubbed it and passed, and
// the install failed on the first real node it reached.
//
// So the resolution is checked statically, over the real sources, in the one
// place a stub cannot stand in for the module. Anything that cannot be resolved
// with certainty is skipped rather than guessed at: the check only ever reports
// a member it can prove is absent.

const fs = require('node:fs');
const nodePath = require('node:path');

const { expect } = require('chai');
const espree = require('espree');

const ROOT = nodePath.join(__dirname, '../..');

const parse = (src) => espree.parse(src, {
  ecmaVersion: 2022, sourceType: 'script', loc: true, range: true,
});

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value.type === 'string') walk(value, visit);
  }
}

// Read off the filesystem rather than asked of git: the unit suite also runs
// inside a container that has no git, and a file that is not yet committed is
// exactly the one whose calls have not been checked by anything.
const sourceFiles = () => fs.readdirSync(nodePath.join(ROOT, 'ZelBack/src'), { recursive: true })
  .map((entry) => nodePath.join('ZelBack/src', entry))
  .filter((file) => file.endsWith('.js'));

const astCache = new Map();
function astOf(relPath) {
  if (!astCache.has(relPath)) {
    try {
      astCache.set(relPath, parse(fs.readFileSync(nodePath.join(ROOT, relPath), 'utf8')));
    } catch {
      astCache.set(relPath, null);
    }
  }
  return astCache.get(relPath);
}

// The names a module exports, or null when they cannot be read with certainty:
// anything but `module.exports = { ...literal keys }` is left alone, because a
// computed or spread export list is one this check cannot enumerate.
const exportCache = new Map();
function exportsOf(relPath) {
  if (exportCache.has(relPath)) return exportCache.get(relPath);
  const ast = astOf(relPath);
  let names = null;
  if (ast) {
    walk(ast, (node) => {
      if (node.type !== 'AssignmentExpression') return;
      const { left, right } = node;
      const isModuleExports = left.type === 'MemberExpression'
        && left.object.type === 'Identifier' && left.object.name === 'module'
        && left.property.type === 'Identifier' && left.property.name === 'exports';
      if (!isModuleExports) return;
      if (right.type !== 'ObjectExpression') { names = null; return; }
      const found = new Set();
      let resolvable = true;
      right.properties.forEach((prop) => {
        if (prop.type !== 'Property' || prop.computed) { resolvable = false; return; }
        if (prop.key.type === 'Identifier') found.add(prop.key.name);
        else if (prop.key.type === 'Literal') found.add(String(prop.key.value));
        else resolvable = false;
      });
      names = resolvable ? found : null;
    });
  }
  exportCache.set(relPath, names);
  return names;
}

// `require('./x')` in a file, resolved to a repo-relative path under ZelBack/src.
function resolveLocal(fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const base = nodePath.resolve(nodePath.dirname(nodePath.join(ROOT, fromRel)), spec);
  for (const candidate of [`${base}.js`, nodePath.join(base, 'index.js')]) {
    if (fs.existsSync(candidate)) {
      const rel = nodePath.relative(ROOT, candidate);
      return rel.startsWith('ZelBack/src') ? rel : null;
    }
  }
  return null;
}

const requireSpecOf = (init) => (
  init && init.type === 'CallExpression'
    && init.callee.type === 'Identifier' && init.callee.name === 'require'
    && init.arguments.length === 1 && init.arguments[0].type === 'Literal'
    && typeof init.arguments[0].value === 'string'
    ? init.arguments[0].value
    : null
);

describe('a call between services names something the callee exports', () => {
  it('resolves every statically known cross-module member call', function () {
    this.timeout(60000);

    const unresolved = [];
    let checkedModules = 0;
    let checkedCalls = 0;

    sourceFiles().forEach((file) => {
      const ast = astOf(file);
      if (!ast) return;

      // identifier -> the module it was required from
      const bound = new Map();
      // members taken apart at the require itself are as absent as called ones
      const destructured = [];

      walk(ast, (node) => {
        if (node.type !== 'VariableDeclarator') return;
        const spec = requireSpecOf(node.init);
        if (!spec) return;
        const target = resolveLocal(file, spec);
        if (!target) return;
        if (node.id.type === 'Identifier') bound.set(node.id.name, target);
        else if (node.id.type === 'ObjectPattern') {
          node.id.properties.forEach((prop) => {
            if (prop.type === 'Property' && !prop.computed && prop.key.type === 'Identifier') {
              destructured.push({ target, member: prop.key.name, line: prop.loc.start.line });
            }
          });
        }
      });

      const seen = new Set();
      const check = (target, member, line) => {
        const names = exportsOf(target);
        if (!names) return;
        const key = `${target}#${member}`;
        if (!seen.has(key)) { seen.add(key); checkedModules += 1; }
        checkedCalls += 1;
        if (!names.has(member)) {
          unresolved.push(`${file}:${line} calls ${member}() on ${target}, which does not export it`);
        }
      };

      destructured.forEach(({ target, member, line }) => check(target, member, line));

      walk(ast, (node) => {
        if (node.type !== 'CallExpression') return;
        const { callee } = node;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.object.type !== 'Identifier' || callee.property.type !== 'Identifier') return;
        const target = bound.get(callee.object.name);
        if (!target) return;
        check(target, callee.property.name, callee.loc.start.line);
      });
    });

    // the canary: a check that resolved nothing would report no problems
    expect(checkedCalls, 'no cross-module calls were resolved, so this proves nothing').to.be.greaterThan(200);
    expect(checkedModules, 'no distinct members were resolved').to.be.greaterThan(50);
    expect(unresolved, `\n${unresolved.join('\n')}\n`).to.deep.equal([]);
  });
});
