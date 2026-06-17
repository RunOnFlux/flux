const chai = require('chai');

const { expect } = chai;
const appTelemetryHost = require('../../ZelBack/src/services/appLifecycle/appTelemetryHost');

describe('appTelemetryHost tests', () => {
  describe('wantsHostMetrics', () => {
    it('returns false for non-string / empty input', () => {
      expect(appTelemetryHost.wantsHostMetrics(undefined)).to.equal(false);
      expect(appTelemetryHost.wantsHostMetrics(null)).to.equal(false);
      expect(appTelemetryHost.wantsHostMetrics(42)).to.equal(false);
      expect(appTelemetryHost.wantsHostMetrics('')).to.equal(false);
    });

    it('returns true for hostMetrics:on (with = / whitespace / case variants)', () => {
      expect(appTelemetryHost.wantsHostMetrics('hostMetrics:on')).to.equal(true);
      expect(appTelemetryHost.wantsHostMetrics('datadog agent; hostMetrics:on')).to.equal(true);
      expect(appTelemetryHost.wantsHostMetrics('hostMetrics = on')).to.equal(true);
      expect(appTelemetryHost.wantsHostMetrics('HOSTMETRICS:ON')).to.equal(true);
    });

    it('returns false when the marker is absent or not :on (no prose false-positives)', () => {
      expect(appTelemetryHost.wantsHostMetrics('just a normal app')).to.equal(false);
      expect(appTelemetryHost.wantsHostMetrics('hostMetrics')).to.equal(false);
      expect(appTelemetryHost.wantsHostMetrics('hostMetrics:off')).to.equal(false);
      expect(appTelemetryHost.wantsHostMetrics('this app reports metrics and telemetry')).to.equal(false);
    });

    it('does not match a longer adjacent key (word boundary)', () => {
      expect(appTelemetryHost.wantsHostMetrics('myhostMetrics:on')).to.equal(false);
    });
  });

  describe('HOST_METRIC_MOUNTS', () => {
    it('is the read-only, AWS-faithful mount set (no privileged/pid-host implied)', () => {
      const sources = appTelemetryHost.HOST_METRIC_MOUNTS.map((m) => m.Source);
      expect(sources).to.have.members(['/var/run/docker.sock', '/proc', '/sys/fs/cgroup', '/etc/passwd']);
      appTelemetryHost.HOST_METRIC_MOUNTS.forEach((m) => {
        expect(m.Type).to.equal('bind');
        expect(m.ReadOnly).to.equal(true);
      });
    });

    it('maps /proc and cgroup to the /host paths the Datadog agent expects', () => {
      const bySource = {};
      appTelemetryHost.HOST_METRIC_MOUNTS.forEach((m) => { bySource[m.Source] = m.Target; });
      expect(bySource['/proc']).to.equal('/host/proc');
      expect(bySource['/sys/fs/cgroup']).to.equal('/host/sys/fs/cgroup');
      expect(bySource['/var/run/docker.sock']).to.equal('/var/run/docker.sock');
    });
  });
});
