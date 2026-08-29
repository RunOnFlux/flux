// Who may hand syncthingService an express object, read from the sources.
//
// syncthingService serves two callers: routes, which carry a request and a
// response, and the reconciler, the monitor and the events consumer, which
// carry neither. When one function served both, it decided what to do by
// whether a `res` was passed - and removing that switch turned every internal
// call into `res.json` on null. The suite could not see it: each of those
// callers wraps the call in a try/catch and logs, so the node stayed up and
// the behaviour simply stopped happening. It took a fleet to notice.
//
// So the separation is asserted statically, over the real source. The Api half
// owns req and res; the internal half takes plain arguments and knows nothing
// about express. Anything this cannot classify is a failure, not a skip.

const fs = require('node:fs');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const { expect } = require('chai');
const espree = require('espree');

const ROOT = nodePath.join(__dirname, '../..');
const SERVICE = 'ZelBack/src/services/syncthingService.js';
const ROUTES = 'ZelBack/src/routes.js';

const parse = (src) => espree.parse(src, {
  ecmaVersion: 2022, sourceType: 'script', loc: true, range: true,
});

function walk(node, visit, enclosing = null) {
  if (!node || typeof node.type !== 'string') return;
  const next = node.type === 'FunctionDeclaration' && node.id ? node.id.name : enclosing;
  visit(node, enclosing);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((c) => walk(c, visit, next));
    else if (value && typeof value.type === 'string') walk(value, visit, next);
  }
}

const sourceFiles = () => execFileSync('git', ['-C', ROOT, 'ls-files', 'ZelBack/src'], { encoding: 'utf8' })
  .split('\n').filter((f) => f.endsWith('.js'));

// name -> declared parameter names, for every top-level function in the service
function serviceFunctions() {
  const src = fs.readFileSync(nodePath.join(ROOT, SERVICE), 'utf8');
  const params = new Map();
  for (const node of parse(src).body) {
    if (node.type === 'FunctionDeclaration' && node.id) {
      params.set(node.id.name, node.params.map((p) => (p.type === 'Identifier' ? p.name : `<${p.type}>`)));
    }
  }
  return params;
}

// every syncthingService.<name>( call outside the service itself, with its file
function externalCalls() {
  const calls = [];
  for (const rel of sourceFiles()) {
    if (rel === SERVICE) continue;
    const src = fs.readFileSync(nodePath.join(ROOT, rel), 'utf8');
    if (!src.includes('syncthingService')) continue;
    // the local identifier(s) the module was required under - it is reached
    // through a dynamic require in several files, to break a cycle
    const aliases = new Set([...src.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*require\([^)]*syncthingService[^)]*\)/g)]
      .map((m) => m[1]));
    if (!aliases.size) continue;
    walk(parse(src), (node) => {
      if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return;
      const { object, property } = node.callee;
      if (object.type !== 'Identifier' || !aliases.has(object.name)) return;
      calls.push({ name: property.name, where: `${rel}:${node.loc.start.line}`, rel });
    });
  }
  return calls;
}

// calls made inside the service to one of its own functions, with the function
// that makes them - this is where the last one hid
function internalCalls(params) {
  const src = fs.readFileSync(nodePath.join(ROOT, SERVICE), 'utf8');
  const calls = [];
  walk(parse(src), (node, enclosing) => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') return;
    if (!params.has(node.callee.name)) return;
    calls.push({ name: node.callee.name, from: enclosing, line: node.loc.start.line });
  });
  return calls;
}

describe('syncthing call shape', () => {
  const params = serviceFunctions();
  const external = externalCalls();
  const internal = internalCalls(params);

  // a sweep that resolves nothing passes every assertion below it, so name the
  // callers this exists to police and fail if any of them went unseen
  it('reaches the router and every internal caller', () => {
    expect(params.size, 'functions in syncthingService').to.be.greaterThan(50);
    const files = [...new Set(external.map((c) => c.rel))];
    for (const caller of [
      ROUTES,
      'ZelBack/src/services/appMonitoring/syncthingFolderStateMachine.js',
      'ZelBack/src/services/appMonitoring/syncthingEventsConsumer.js',
      'ZelBack/src/services/appMonitoring/syncthingMonitor.js',
      'ZelBack/src/services/appMonitoring/peerFolderLiveness.js',
      'ZelBack/src/services/appLifecycle/advancedWorkflows.js',
      'ZelBack/src/services/systemService.js',
      'ZelBack/src/services/fluxService.js',
    ]) {
      expect(files, `the sweep never reached ${caller}`).to.include(caller);
    }
  });

  it('every call site names a function that exists', () => {
    const unknown = external.filter((c) => !params.has(c.name)).map((c) => `${c.where} -> ${c.name}`);
    expect(unknown, 'call sites this sweep could not resolve').to.deep.equal([]);
  });

  it('only routes.js calls an Api handler', () => {
    const stray = external
      .filter((c) => c.name.endsWith('Api') && c.rel !== ROUTES)
      .map((c) => `${c.where} -> ${c.name}`);
    expect(stray, 'an Api handler is the wire, and only the router speaks it').to.deep.equal([]);
  });

  it('nothing but routes.js hands syncthingService an express object', () => {
    const offenders = external
      .filter((c) => c.rel !== ROUTES)
      .filter((c) => (params.get(c.name) || []).some((p) => p === 'req' || p === 'res'))
      .map((c) => `${c.where} -> ${c.name}(${params.get(c.name).join(', ')})`);
    expect(offenders, 'an internal caller has no request and no response to give').to.deep.equal([]);
  });

  it('inside the service, only an Api handler calls a function that takes req or res', () => {
    const offenders = internal
      .filter((c) => !(c.from || '').endsWith('Api'))
      .filter((c) => (params.get(c.name) || []).some((p) => p === 'req' || p === 'res'))
      .map((c) => `${SERVICE}:${c.line} ${c.from} -> ${c.name}(${params.get(c.name).join(', ')})`);
    expect(offenders, 'a non-Api caller has no express objects to pass on').to.deep.equal([]);
  });
});
