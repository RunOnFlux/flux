const { expect } = require('chai');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const { makeStickyDosDouble } = require('./stickyDosTestDouble');

const HOST = 'pid:[4026531836]';
const CONTAINER = 'pid:[4026532467]';

describe('containerRuntimeService tests', () => {
  let service;
  let dos;
  let documents;
  let bundleListener;
  let logStub;
  let dir;

  // The PID namespace link as the kernel names it: a symlink whose target is
  // `pid:[<inode>]`, read without being followed.
  async function namespaceLink(target) {
    const link = path.join(dir, `ns-${Math.random().toString(16).slice(2)}`);
    await fs.symlink(target, link);
    return link;
  }

  // A policy bundle arriving, delivered the way adoption delivers it.
  function adopt(nextDocuments) {
    documents = nextDocuments;
    bundleListener({ seq: 2, source: 'peer' });
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'container-runtime-'));
    dos = makeStickyDosDouble();
    documents = null;
    bundleListener = null;
    logStub = { error: sinon.stub(), warn: sinon.stub(), info: sinon.stub() };
    service = proxyquire('../../ZelBack/src/services/containerRuntimeService', {
      '../lib/log': logStub,
      './nodeDosState': dos,
      './policyStore': {
        getDocument: (name) => documents?.[name] ?? null,
        onBundleChanged: (listener) => { bundleListener = listener; return () => { bundleListener = null; }; },
      },
    });
  });

  afterEach(async () => {
    service.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('names the host namespace by the inode the kernel gives it', () => {
    expect(service.HOST_PID_NAMESPACE).to.equal(4026531836);
  });

  describe('a node on a host or in a virtual machine', () => {
    it('is never held, whatever the policy says', async () => {
      documents = { containerdos: true };
      await service.start({ pidNamespaceLink: await namespaceLink(HOST) });
      adopt({ containerdos: true });

      expect(dos.holds.has(dos.StickyDosOwner.CONTAINER_RUNTIME)).to.equal(false);
      expect(service.getStatus()).to.deep.equal({ inContainer: false, pidNamespace: 4026531836, dosEnabled: true });
    });
  });

  describe('a node in a container', () => {
    it('reports what it is and serves on while the policy does not hold it', async () => {
      await service.start({ pidNamespaceLink: await namespaceLink(CONTAINER) });

      expect(dos.holds.has(dos.StickyDosOwner.CONTAINER_RUNTIME)).to.equal(false);
      expect(service.getStatus()).to.deep.equal({ inContainer: true, pidNamespace: 4026532467, dosEnabled: false });
    });

    it('is held from start when the policy it already holds says so', async () => {
      documents = { containerdos: true };
      await service.start({ pidNamespaceLink: await namespaceLink(CONTAINER) });

      expect(dos.holds.get(dos.StickyDosOwner.CONTAINER_RUNTIME)).to.match(/running in a container/);
    });

    it('is held once a bundle turning the policy on is adopted, and released by one turning it off', async () => {
      await service.start({ pidNamespaceLink: await namespaceLink(CONTAINER) });

      adopt({ containerdos: true });
      expect(dos.holds.has(dos.StickyDosOwner.CONTAINER_RUNTIME)).to.equal(true);

      adopt({});
      expect(dos.holds.has(dos.StickyDosOwner.CONTAINER_RUNTIME)).to.equal(false);
    });

    it('is held only by the value true', async () => {
      await service.start({ pidNamespaceLink: await namespaceLink(CONTAINER) });

      ['true', 1, { enabled: true }, null].forEach((value) => {
        adopt({ containerdos: value });
        expect(dos.holds.has(dos.StickyDosOwner.CONTAINER_RUNTIME), JSON.stringify(value)).to.equal(false);
      });
    });

    it('leaves every other owner\'s hold standing when it releases its own', async () => {
      dos.holds.set(dos.StickyDosOwner.NODEJS_FLOOR, 'NodeJS below the floor');
      await service.start({ pidNamespaceLink: await namespaceLink(CONTAINER) });
      adopt({ containerdos: true });
      adopt({});

      expect([...dos.holds.keys()]).to.deep.equal([dos.StickyDosOwner.NODEJS_FLOOR]);
    });
  });

  describe('an unreadable namespace decides nothing', () => {
    it('gives no verdict when the link cannot be read', async () => {
      documents = { containerdos: true };
      await service.start({ pidNamespaceLink: path.join(dir, 'missing') });

      expect(dos.holds.has(dos.StickyDosOwner.CONTAINER_RUNTIME)).to.equal(false);
      expect(service.getStatus().inContainer).to.equal(null);
      sinon.assert.calledWithMatch(logStub.error, /cannot read/);
    });

    it('gives no verdict when the link does not name a PID namespace', async () => {
      documents = { containerdos: true };
      await service.start({ pidNamespaceLink: await namespaceLink('net:[4026531840]') });

      expect(dos.holds.has(dos.StickyDosOwner.CONTAINER_RUNTIME)).to.equal(false);
      expect(service.getStatus().inContainer).to.equal(null);
      sinon.assert.calledWithMatch(logStub.error, /not a PID namespace/);
    });
  });

  it('reads the namespace once and follows the policy once, however often it is started', async () => {
    await service.start({ pidNamespaceLink: await namespaceLink(CONTAINER) });
    const listener = bundleListener;
    await service.start({ pidNamespaceLink: await namespaceLink(HOST) });

    expect(bundleListener).to.equal(listener);
    expect(service.getStatus().inContainer).to.equal(true);
  });

  it('reads the namespace of the process running it by default', async () => {
    await service.start();

    expect(service.getStatus().pidNamespace).to.equal(Number((await fs.readlink('/proc/self/ns/pid')).match(/\d+/)[0]));
  });
});
