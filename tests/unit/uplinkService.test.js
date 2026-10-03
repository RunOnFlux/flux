const { EventEmitter } = require('node:events');
const fsPromises = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const chai = require('chai');
const sinon = require('sinon');

const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const { Privilege } = require('../../ZelBack/src/services/utils/privileges');
const uplinkService = require('../../ZelBack/src/services/uplinkService');

const { expect } = chai;
const { Tunnel, Reason, ProbeMethod } = uplinkService;

const RTT_LINE = (min) => `rtt min/avg/max/mdev = ${min}/${min + 1}/${min + 2}/0.5 ms`;

/**
 * A path whose largest packet is `pathMtu`. A router that names the size
 * answers oversized packets with frag-needed; a blackhole drops them silently.
 */
function pingPath({ pathMtu, namesSize, reportedBy = '172.16.16.1' }) {
  return (size) => {
    const mtu = size + 28;
    if (mtu <= pathMtu) return `${size + 8} bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=20 ms`;
    if (namesSize) return `From ${reportedBy} icmp_seq=1 Frag needed and DF set (mtu = ${pathMtu})`;
    return '2 packets transmitted, 0 received, 100% packet loss';
  };
}

/**
 * Routes runCommand by tool and arguments to the answers a test sets.
 */
function stubTools({
  probe = () => '', ss = '', ownIp = () => '',
} = {}) {
  return sinon.stub(serviceHelper, 'runCommand').callsFake(async (cmd, { params }) => {
    if (cmd === 'ss') return { stdout: ss, stderr: '', error: null };
    const args = params.map(String);
    const sizeAt = args.indexOf('-s');
    if (sizeAt !== -1) return { stdout: probe(Number(args[sizeAt + 1]), args[args.length - 1]), stderr: '', error: null };
    return { stdout: ownIp(args[args.length - 1]), stderr: '', error: null };
  });
}

/**
 * `ss -tinH state established` lines: the socket, then its TCP state.
 */
function ssLines(conns) {
  return conns.map(([local, peer, mss]) => `0      0      ${local}      ${peer}\n\t cubic wscale:10,10 rto:272 mss:${mss} pmtu:1500 rcvmss:${mss} advmss:1448 cwnd:10`).join('\n');
}

const MULE_PEERS = ssLines([
  ['172.16.16.61:40506', '65.21.84.213:16125', 1368],
  ['172.16.16.61:56158', '65.108.72.80:16125', 1368],
  ['172.16.16.61:56160', '[::ffff:95.216.1.2]:16127', 1368],
  ['172.16.16.61:56170', '88.99.1.3:16137', 1274],
  ['127.0.0.1:57936', '127.0.0.1:27017', 65483],
  ['169.254.43.43:16187', '169.254.43.43:41000', 32768],
  ['172.16.16.61:41001', '172.16.16.9:16127', 1448],
]);

/**
 * A socket that completes its handshake, or never answers.
 */
function fakeSocket({ connects }) {
  const socket = new EventEmitter();
  socket.setTimeout = sinon.stub();
  socket.destroy = sinon.stub();
  setImmediate(() => socket.emit(connects ? 'connect' : 'error', new Error('ECONNREFUSED')));
  return socket;
}

describe('uplinkService tests', () => {
  afterEach(() => {
    sinon.restore();
    uplinkService.reset();
  });

  describe('parsePing', () => {
    it('reads a reply', () => {
      expect(uplinkService.parsePing('1480 bytes from 1.1.1.1: icmp_seq=1 ttl=52 time=22.9 ms'))
        .to.eql({ replied: true, mtu: null });
    });

    it('reads the size a router names', () => {
      expect(uplinkService.parsePing('From 172.16.16.1 icmp_seq=1 Frag needed and DF set (mtu = 1420)'))
        .to.eql({ replied: false, mtu: 1420 });
    });

    it('reads the size the kernel holds from an earlier answer', () => {
      expect(uplinkService.parsePing('ping: local error: message too long, mtu=1420'))
        .to.eql({ replied: false, mtu: 1420 });
    });

    it('reads silence as neither', () => {
      expect(uplinkService.parsePing('2 packets transmitted, 0 received, 100% packet loss'))
        .to.eql({ replied: false, mtu: null });
    });
  });

  describe('parsePingRtt', () => {
    it('takes the minimum', () => {
      expect(uplinkService.parsePingRtt(RTT_LINE(18.554))).to.equal(18.554);
    });

    it('is null without a summary', () => {
      expect(uplinkService.parsePingRtt('100% packet loss')).to.equal(null);
    });
  });

  describe('parsePeerMss', () => {
    it('keeps routable IPv4 peers, unwrapping the mapped form, and drops local ones', () => {
      const byPeer = uplinkService.parsePeerMss(MULE_PEERS);
      expect([...byPeer.entries()]).to.eql([
        ['65.21.84.213', 1368],
        ['65.108.72.80', 1368],
        ['95.216.1.2', 1368],
        ['88.99.1.3', 1274],
      ]);
    });

    it('keeps the highest segment size per peer', () => {
      const byPeer = uplinkService.parsePeerMss(ssLines([
        ['10.0.0.2:1', '65.21.84.213:16125', 1200],
        ['10.0.0.2:2', '65.21.84.213:16127', 1368],
      ]));
      expect(byPeer.get('65.21.84.213')).to.equal(1368);
    });
  });

  describe('probeTarget', () => {
    it('reports a full path', async () => {
      stubTools({ probe: pingPath({ pathMtu: 1500 }) });
      expect(await uplinkService.probeTarget('1.1.1.1')).to.eql({ value: 1500, method: ProbeMethod.FULL });
    });

    it('takes the size a router names, without searching for it', async () => {
      const tools = stubTools({ probe: pingPath({ pathMtu: 1420, namesSize: true }) });
      expect(await uplinkService.probeTarget('1.1.1.1')).to.eql({ value: 1420, method: ProbeMethod.FRAG_NEEDED });
      sinon.assert.calledOnce(tools);
    });

    it('finds the size of a path that drops oversized packets silently', async () => {
      stubTools({ probe: pingPath({ pathMtu: 1437 }) });
      expect(await uplinkService.probeTarget('1.1.1.1')).to.eql({ value: 1437, method: ProbeMethod.NO_REPLY });
    });

    it('is null for a target that answers nothing', async () => {
      stubTools({ probe: () => '100% packet loss' });
      expect(await uplinkService.probeTarget('1.1.1.1')).to.equal(null);
    });
  });

  describe('probePathMtu', () => {
    it('takes the largest result, so a limit at one target\'s end does not count', async () => {
      stubTools({
        probe: (size, target) => pingPath({ pathMtu: target === '8.8.8.8' ? 1420 : 1500, namesSize: true })(size),
      });
      expect(await uplinkService.probePathMtu()).to.eql({ value: 1500, method: ProbeMethod.FULL });
    });
  });

  describe('peerTcpMss', () => {
    it('takes the highest across routable peers', async () => {
      stubTools({ ss: MULE_PEERS });
      expect(await uplinkService.peerTcpMss()).to.equal(1368);
    });

    it('is null with too few peers', async () => {
      stubTools({
        ss: ssLines([
          ['10.0.0.2:1', '65.21.84.213:16125', 1368],
          ['10.0.0.2:2', '65.108.72.80:16125', 1368],
        ]),
      });
      expect(await uplinkService.peerTcpMss()).to.equal(null);
    });
  });

  describe('combinedMtu', () => {
    it('takes the clamp when a fragmenting tunnel passes the probe', () => {
      expect(uplinkService.combinedMtu({ value: 1500 }, 1388)).to.equal(1440);
    });

    it('agrees with the probe on a tunnel that refuses oversized packets', () => {
      expect(uplinkService.combinedMtu({ value: 1420 }, 1368)).to.equal(1420);
    });

    it('reads an unclamped path as full', () => {
      expect(uplinkService.combinedMtu({ value: 1500 }, 1448)).to.equal(1500);
    });

    it('never reads above full from a peer without timestamps', () => {
      expect(uplinkService.combinedMtu(null, 1460)).to.equal(1500);
    });

    it('is null with nothing measured', () => {
      expect(uplinkService.combinedMtu(null, null)).to.equal(null);
    });
  });

  describe('decide', () => {
    const clean = {
      rttMs: 0.19, tunnelInterfaces: [], egressDevice: 'ens18', publicIpElsewhere: false,
    };
    const wireguard = { name: 'wg0', kind: 'wireguard', mtu: 1420 };
    const tailscale = { name: 'tailscale0', kind: 'tun', mtu: 1280 };

    it('reads a node at its public address as no tunnel', () => {
      expect(uplinkService.decide(clean)).to.eql({ tunnel: Tunnel.NONE, reason: null });
    });

    it('calls a tunnel interface the traffic leaves by', () => {
      expect(uplinkService.decide({ ...clean, tunnelInterfaces: [tailscale, wireguard], egressDevice: 'wg0' }))
        .to.eql({ tunnel: Tunnel.LIKELY, reason: Reason.INTERFACE });
    });

    it('leaves a tunnel interface the traffic does not use to the distance', () => {
      expect(uplinkService.decide({ ...clean, tunnelInterfaces: [tailscale] }))
        .to.eql({ tunnel: Tunnel.NONE, reason: null });
      expect(uplinkService.decide({ ...clean, tunnelInterfaces: [tailscale], rttMs: 18.6 }))
        .to.eql({ tunnel: Tunnel.LIKELY, reason: Reason.DISTANCE });
    });

    it('leaves tunnel interfaces to the distance when the egress device is unknown', () => {
      expect(uplinkService.decide({ ...clean, tunnelInterfaces: [wireguard], egressDevice: null }))
        .to.eql({ tunnel: Tunnel.NONE, reason: null });
    });

    it('calls a public address bound off the default route', () => {
      expect(uplinkService.decide({ ...clean, publicIpElsewhere: true }))
        .to.eql({ tunnel: Tunnel.LIKELY, reason: Reason.LOCAL_PUBLIC_IP });
    });

    it('calls a public address that is far away', () => {
      expect(uplinkService.decide({ ...clean, rttMs: 18.6 }))
        .to.eql({ tunnel: Tunnel.LIKELY, reason: Reason.DISTANCE });
    });


    it('does not decide on a full-size path with no distance', () => {
      expect(uplinkService.decide({ ...clean, rttMs: null }))
        .to.eql({ tunnel: Tunnel.UNKNOWN, reason: null });
    });
  });

  describe('measureDistance', () => {
    it('times a ping to the public address', async () => {
      stubTools({ ownIp: () => RTT_LINE(18.73) });
      const connect = sinon.stub(net, 'connect');
      expect(await uplinkService.measureDistance('178.79.183.164', 16187)).to.eql({ rttMs: 18.73, method: 'icmp' });
      sinon.assert.notCalled(connect);
    });

    it('times a handshake with its own API port when the ping goes unanswered', async () => {
      stubTools({ ownIp: () => '100% packet loss' });
      const connect = sinon.stub(net, 'connect').callsFake(() => fakeSocket({ connects: true }));
      const distance = await uplinkService.measureDistance('178.79.183.164', 16187);
      expect(distance.method).to.equal('tcp');
      expect(distance.rttMs).to.be.a('number');
      sinon.assert.calledWith(connect, { host: '178.79.183.164', port: 16187 });
    });

    it('is null when neither answers', async () => {
      stubTools({ ownIp: () => '100% packet loss' });
      sinon.stub(net, 'connect').callsFake(() => fakeSocket({ connects: false }));
      expect(await uplinkService.measureDistance('178.79.183.164', 16187)).to.eql({ rttMs: null, method: null });
    });
  });


  describe('findTunnelInterfaces', () => {
    const sysfs = {
      lo: { type: '772' },
      ens18: { type: '1', mtu: '1500' },
      docker0: { type: '1', mtu: '1500' },
      wg0: { type: '65534', mtu: '1420', uevent: 'DEVTYPE=wireguard\nINTERFACE=wg0\n' },
      tun0: { type: '65534', mtu: '1500', tun_flags: '0x1001' },
      tap0: { type: '1', mtu: '1500', tun_flags: '0x1002' },
      gre1: { type: '778', mtu: '1476', operstate: 'unknown\n' },
      tunl0: { type: '768', mtu: '1480', operstate: 'down\n' },
      sit0: { type: '776', mtu: '1480', operstate: 'down\n' },
      tun1: { type: '65534', mtu: '1500', tun_flags: '0x1001', operstate: 'down\n' },
    };

    beforeEach(() => {
      sinon.stub(fsPromises, 'readdir').resolves(Object.keys(sysfs));
      sinon.stub(fsPromises, 'readFile').callsFake(async (file) => {
        const [, , , , name, field] = file.split('/');
        const value = sysfs[name]?.[field];
        if (value === undefined) throw new Error('ENOENT');
        return value;
      });
    });

    it('names each tunnel that is not down by kind, and leaves ordinary interfaces out', async () => {
      expect(await uplinkService.findTunnelInterfaces()).to.eql([
        { name: 'wg0', kind: 'wireguard', mtu: 1420 },
        { name: 'tun0', kind: 'tun', mtu: 1500 },
        { name: 'tap0', kind: 'tap', mtu: 1500 },
        { name: 'gre1', kind: 'gre', mtu: 1476 },
      ]);
    });
  });

  describe('publicIpBinding', () => {
    const interfaces = (bindings) => Object.fromEntries(Object.entries(bindings)
      .map(([name, address]) => [name, [{ family: 'IPv4', address, internal: name === 'lo' }]]));

    it('reads an address on the egress device as bound there', () => {
      sinon.stub(os, 'networkInterfaces').returns(interfaces({ lo: '127.0.0.1', ens18: '38.247.82.141' }));
      expect(uplinkService.publicIpBinding('38.247.82.141', 'ens18')).to.eql({ bound: true, elsewhere: false });
    });

    it('reads an address bound off the egress device as elsewhere', () => {
      sinon.stub(os, 'networkInterfaces').returns(interfaces({ lo: '178.79.183.164', ens18: '172.16.16.61' }));
      expect(uplinkService.publicIpBinding('178.79.183.164', 'ens18')).to.eql({ bound: true, elsewhere: true });
    });

    it('reads an address on a label of the egress device as bound there', () => {
      sinon.stub(os, 'networkInterfaces').returns(interfaces({ lo: '127.0.0.1', eth0: '10.0.0.5', 'eth0:1': '203.0.113.7' }));
      expect(uplinkService.publicIpBinding('203.0.113.7', 'eth0')).to.eql({ bound: true, elsewhere: false });
    });

    it('reads an address on a label of another device as elsewhere', () => {
      sinon.stub(os, 'networkInterfaces').returns(interfaces({ eth0: '10.0.0.5', 'eth1:1': '203.0.113.7' }));
      expect(uplinkService.publicIpBinding('203.0.113.7', 'eth0')).to.eql({ bound: true, elsewhere: true });
    });

    it('reads an address on the physical device as elsewhere when the traffic leaves by a tunnel', () => {
      sinon.stub(os, 'networkInterfaces').returns(interfaces({ eth0: '203.0.113.7', wg0: '10.66.0.2' }));
      expect(uplinkService.publicIpBinding('203.0.113.7', 'wg0')).to.eql({ bound: true, elsewhere: true });
    });

    it('reads an address behind a gateway as not bound', () => {
      sinon.stub(os, 'networkInterfaces').returns(interfaces({ lo: '127.0.0.1', ens18: '172.16.16.61' }));
      expect(uplinkService.publicIpBinding('178.79.183.164', 'ens18')).to.eql({ bound: false, elsewhere: false });
    });

    it('makes no claim when the egress device is unknown', () => {
      sinon.stub(os, 'networkInterfaces').returns(interfaces({ lo: '178.79.183.164', ens18: '172.16.16.61' }));
      expect(uplinkService.publicIpBinding('178.79.183.164', null)).to.eql({ bound: true, elsewhere: false });
    });
  });

  describe('measuring and the readers', () => {
    beforeEach(() => {
      sinon.stub(os, 'networkInterfaces').returns({ ens18: [{ family: 'IPv4', address: '172.16.16.61', internal: false }] });
      sinon.stub(fluxNetworkHelper, 'egressDevice').resolves('ens18');
      sinon.stub(fsPromises, 'readdir').resolves(['ens18']);
      sinon.stub(fsPromises, 'readFile').callsFake(async (file) => {
        if (file.endsWith('/type')) return '1';
        if (file.endsWith('/mtu')) return '1500';
        throw new Error('ENOENT');
      });
    });

    it('reads nothing before the first measurement', () => {
      expect(uplinkService.getUplinkSummary()).to.eql({ tunnel: Tunnel.UNKNOWN, mtu: null, rttMs: null });
      expect(uplinkService.getUplink().measuredAt).to.equal(null);
    });

    it('records a WireGuard node behind its router', async () => {
      stubTools({
        probe: pingPath({ pathMtu: 1420, namesSize: true }),
        ss: MULE_PEERS,
        ownIp: () => RTT_LINE(18.73),
      });

      await uplinkService.noteAddress('178.79.183.164:16187');

      const record = uplinkService.getUplink();
      expect(record).to.deep.include({
        tunnel: Tunnel.LIKELY,
        reason: Reason.DISTANCE,
        mtu: {
          value: 1420, probe: 1420, probeMethod: ProbeMethod.FRAG_NEEDED, tcpMss: 1368,
        },
        distance: { rttMs: 18.73, method: 'icmp' },
        publicIpLocal: false,
        egressDevice: 'ens18',
        tunnelInterfaces: [],
      });
      expect(record.measuredAt).to.be.a('string');
      expect(uplinkService.getUplinkSummary()).to.eql({ tunnel: Tunnel.LIKELY, mtu: 1420, rttMs: 18.73 });
    });

    it('calls a node whose traffic leaves by its WireGuard interface', async () => {
      fluxNetworkHelper.egressDevice.resolves('wg0');
      fsPromises.readdir.resolves(['ens18', 'wg0']);
      fsPromises.readFile.callsFake(async (file) => {
        if (file === '/sys/class/net/wg0/uevent') return 'DEVTYPE=wireguard\nINTERFACE=wg0\n';
        if (file.endsWith('/type')) return file.includes('wg0') ? '65534' : '1';
        if (file.endsWith('/mtu')) return file.includes('wg0') ? '1420' : '1500';
        throw new Error('ENOENT');
      });
      stubTools({ probe: pingPath({ pathMtu: 1420, namesSize: true }), ss: MULE_PEERS, ownIp: () => RTT_LINE(2.1) });

      await uplinkService.noteAddress('203.0.113.21:16127');

      expect(uplinkService.getUplink()).to.deep.include({
        tunnel: Tunnel.LIKELY,
        reason: Reason.INTERFACE,
        egressDevice: 'wg0',
        tunnelInterfaces: [{ name: 'wg0', kind: 'wireguard', mtu: 1420 }],
      });
    });

    it('does not call a node whose tunnel interface its traffic does not use', async () => {
      fsPromises.readdir.resolves(['ens18', 'tailscale0']);
      fsPromises.readFile.callsFake(async (file) => {
        if (file === '/sys/class/net/tailscale0/tun_flags') return '0x1002';
        if (file.endsWith('/type')) return file.includes('tailscale0') ? '65534' : '1';
        if (file.endsWith('/mtu')) return file.includes('tailscale0') ? '1280' : '1500';
        throw new Error('ENOENT');
      });
      stubTools({ probe: pingPath({ pathMtu: 1500, namesSize: false }), ss: MULE_PEERS, ownIp: () => RTT_LINE(0.31) });

      await uplinkService.noteAddress('203.0.113.22:16127');

      expect(uplinkService.getUplink()).to.deep.include({
        tunnel: Tunnel.NONE,
        reason: null,
        egressDevice: 'ens18',
        tunnelInterfaces: [{ name: 'tailscale0', kind: 'tun', mtu: 1280 }],
      });
    });

    it('does not decide when the node cannot time its own address, and walks no path', async () => {
      sinon.stub(net, 'connect').callsFake(() => fakeSocket({ connects: false }));
      const tools = stubTools({ probe: pingPath({ pathMtu: 1500, namesSize: false }), ss: MULE_PEERS });

      await uplinkService.noteAddress('203.0.113.23:16127');

      expect(uplinkService.getUplink()).to.deep.include({
        tunnel: Tunnel.UNKNOWN,
        reason: null,
        distance: { rttMs: null, method: null },
      });
      const pings = tools.getCalls().filter((call) => call.args[0] === 'ping').map((call) => call.args[1].params.map(String));
      expect(pings.some((args) => args.at(-1) === '203.0.113.23')).to.equal(true);
      expect(pings.filter((args) => args.includes('-t'))).to.eql([]);
    });

    it('does not call an encapsulated path whose public address is near', async () => {
      stubTools({
        probe: pingPath({ pathMtu: 1492, namesSize: true }),
        ss: MULE_PEERS.replace(/mss:1368/g, 'mss:1440'),
        ownIp: () => RTT_LINE(0.31),
      });

      await uplinkService.noteAddress('203.0.113.20:16127');

      expect(uplinkService.getUplinkSummary()).to.eql({ tunnel: Tunnel.NONE, mtu: 1492, rttMs: 0.31 });
    });

    it('measures nothing before the node knows its address', async () => {
      const tools = stubTools();

      await uplinkService.measureOnce();

      sinon.assert.notCalled(tools);
      expect(uplinkService.getUplink().measuredAt).to.equal(null);
    });

    it('hands out a copy, so a reader cannot change the record', async () => {
      uplinkService.getUplink().mtu.value = 1;
      expect(uplinkService.getUplink().mtu.value).to.equal(null);
    });
  });

  describe('scheduling', () => {
    let pingedOwnIps;

    /**
     * Tools that answer at once, recording which address each run timed.
     */
    function recordingTools() {
      pingedOwnIps = [];
      return stubTools({ ownIp: (target) => { pingedOwnIps.push(target); return RTT_LINE(0.2); } });
    }

    beforeEach(() => {
      sinon.stub(fluxNetworkHelper, 'egressDevice').resolves(null);
      sinon.stub(fsPromises, 'readdir').resolves([]);
      sinon.stub(net, 'connect').callsFake(() => fakeSocket({ connects: false }));
    });

    it('shares a run in progress rather than starting another', async () => {
      recordingTools();
      uplinkService.noteAddress('203.0.113.30:16127');

      await Promise.all([uplinkService.measureOnce(), uplinkService.measureOnce()]);

      expect(pingedOwnIps).to.eql(['203.0.113.30']);
    });

    it('measures an address learned after the last run ended', async () => {
      recordingTools();

      await uplinkService.noteAddress('203.0.113.34:16127');
      await uplinkService.noteAddress('203.0.113.35:16127');

      expect(pingedOwnIps).to.eql(['203.0.113.34', '203.0.113.35']);
    });

    it('measures again, once, for the latest address when it changes mid-run', async () => {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      pingedOwnIps = [];
      let ssCalls = 0;
      sinon.stub(serviceHelper, 'runCommand').callsFake(async (cmd, { params }) => {
        if (cmd === 'ss') {
          ssCalls += 1;
          if (ssCalls === 1) await held;
        }
        const args = params.map(String);
        if (args[args.indexOf('-c') + 1] === '5') pingedOwnIps.push(args[args.length - 1]);
        return { stdout: '', stderr: '', error: null };
      });

      const first = uplinkService.noteAddress('203.0.113.31:16127');
      await new Promise(setImmediate);
      uplinkService.noteAddress('203.0.113.32:16127');
      uplinkService.noteAddress('203.0.113.33:16127');
      release();
      await first;

      expect(pingedOwnIps).to.eql(['203.0.113.31', '203.0.113.33']);
    });

    it('measures at start when the node already knows its address', async () => {
      recordingTools();
      sinon.stub(fluxNetworkHelper, 'getKnownLocalSocketAddress').returns('203.0.113.40:16127');

      uplinkService.start();
      await uplinkService.measureOnce();

      expect(pingedOwnIps).to.eql(['203.0.113.40']);
    });

    it('waits for the node to learn its address, then measures for it', async () => {
      recordingTools();
      sinon.stub(fluxNetworkHelper, 'getKnownLocalSocketAddress').returns(null);

      uplinkService.start();
      await uplinkService.measureOnce();
      expect(pingedOwnIps).to.eql([]);

      fluxNetworkHelper.setLocalSocketAddress('203.0.113.41:16127');
      await uplinkService.measureOnce();

      expect(pingedOwnIps).to.eql(['203.0.113.41']);
    });

    it('stops listening for addresses when stopped', async () => {
      const tools = recordingTools();
      sinon.stub(fluxNetworkHelper, 'getKnownLocalSocketAddress').returns(null);

      uplinkService.start();
      uplinkService.stop();
      fluxNetworkHelper.setLocalSocketAddress('203.0.113.42:16127');
      await uplinkService.measureOnce();

      sinon.assert.notCalled(tools);
    });

    it('keeps one schedule however often it is started', () => {
      const clock = sinon.useFakeTimers();
      sinon.stub(fluxNetworkHelper, 'getKnownLocalSocketAddress').returns(null);
      const listen = sinon.spy(fluxNetworkHelper, 'onLocalSocketAddressChange');

      uplinkService.start();
      uplinkService.start();

      sinon.assert.calledOnce(listen);
      expect(clock.countTimers()).to.equal(1);
      uplinkService.stop();
      expect(clock.countTimers()).to.equal(0);
    });
  });

  describe('uplinkAPI', () => {
    function fakeRes() {
      return { json: sinon.stub().returnsArg(0) };
    }

    it('refuses a caller who is neither the node operator nor the Flux team', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      const res = fakeRes();
      await uplinkService.uplinkAPI({ headers: {} }, res);
      expect(res.json.firstCall.args[0].status).to.equal('error');
      expect(res.json.firstCall.args[0].data.code).to.equal(401);
    });

    it('gives the full record to the node operator or the Flux team', async () => {
      const verify = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      const res = fakeRes();
      await uplinkService.uplinkAPI({ headers: {} }, res);
      sinon.assert.calledWith(verify, Privilege.NODE_OPERATOR_OR_FLUX_TEAM);
      expect(res.json.firstCall.args[0]).to.eql({ status: 'success', data: uplinkService.getUplink() });
    });
  });
});
