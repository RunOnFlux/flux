// Every request this node makes of the UPnP router runs as a portReconciler
// turn, read from the sources: only upnpRouter builds a router client, and only
// portReconciler takes from upnpRouter the client or a call that uses it. Any
// other module reaches the router through portReconciler.onRouter, which hands
// the client to the turn.

const fs = require('node:fs');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const { expect } = require('chai');
const espree = require('espree');

const ROOT = nodePath.join(__dirname, '../..');
// what upnpRouter exports that sends a request to the router
const ROUTER_CALLS = new Set(['client', 'mapProtocol', 'removeProtocol', 'routerMapsHere']);

const sourceFiles = () => execFileSync('git', ['-C', ROOT, 'ls-files', 'ZelBack/src', 'apiServer.js'], { encoding: 'utf8' })
  .split('\n').filter((f) => f.endsWith('.js'));

const requiredPath = (node) => (node?.type === 'CallExpression'
  && node.callee.type === 'Identifier' && node.callee.name === 'require'
  && node.arguments[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string'
  ? node.arguments[0].value : null);
const isRequireOf = (node, name) => nodePath.basename(requiredPath(node) ?? '') === name;

/**
 * The router calls each source takes from upnpRouter, and the router clients it
 * builds, by file.
 * @returns {{calls: Map<string, string[]>, clients: string[]}}
 */
function routerAccess() {
  const calls = new Map();
  const clients = [];
  sourceFiles().forEach((rel) => {
    const src = fs.readFileSync(nodePath.join(ROOT, rel), 'utf8');
    if (!src.includes('upnpRouter') && !src.includes('nat-upnp')) return;
    const ast = espree.parse(src, { ecmaVersion: 2022, sourceType: 'script' });
    const routerBindings = new Set();
    const natUpnpBindings = new Set();
    const clientClasses = new Set();
    const taken = [];
    const walk = (node) => {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'VariableDeclarator' && requiredPath(node.init) === '@runonflux/nat-upnp') {
        if (node.id.type === 'ObjectPattern') {
          node.id.properties.forEach((property) => {
            if (property.key.name === 'Client') clientClasses.add(property.value.name);
          });
        } else {
          natUpnpBindings.add(node.id.name);
        }
      }
      if (node.type === 'VariableDeclarator' && isRequireOf(node.init, 'upnpRouter')) {
        if (node.id.type === 'ObjectPattern') {
          node.id.properties.forEach((property) => {
            if (ROUTER_CALLS.has(property.key.name)) taken.push(property.key.name);
          });
        } else {
          routerBindings.add(node.id.name);
        }
      }
      if (node.type === 'MemberExpression' && node.object.type === 'Identifier'
          && routerBindings.has(node.object.name) && ROUTER_CALLS.has(node.property.name)) {
        taken.push(node.property.name);
      }
      if (node.type === 'NewExpression'
          && ((node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier'
            && natUpnpBindings.has(node.callee.object.name) && node.callee.property.name === 'Client')
            || (node.callee.type === 'Identifier' && clientClasses.has(node.callee.name)))) {
        clients.push(rel);
      }
      Object.values(node).forEach((child) => {
        if (Array.isArray(child)) child.forEach(walk);
        else if (child && typeof child === 'object') walk(child);
      });
    };
    walk(ast);
    if (taken.length) calls.set(rel, [...new Set(taken)].sort());
  });
  return { calls, clients };
}

describe('router access tests', () => {
  const { calls, clients } = routerAccess();

  it('only portReconciler takes the router client or a call that uses it from upnpRouter', () => {
    expect(Object.fromEntries(calls)).to.deep.equal({
      'ZelBack/src/services/portReconciler.js': ['client', 'mapProtocol', 'removeProtocol', 'routerMapsHere'],
    });
  });

  it('only upnpRouter builds a router client', () => {
    expect([...new Set(clients)]).to.deep.equal(['ZelBack/src/services/upnpRouter.js']);
  });
});
