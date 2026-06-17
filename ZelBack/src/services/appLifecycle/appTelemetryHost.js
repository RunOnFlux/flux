/**
 * Telemetry host access — v8 enterprise stop-gap (TEMPORARY)
 *
 * Lets an enterprise client run their own Datadog (or similar) agent on a v8
 * spec by giving the agent component the read-only host mounts a standard
 * Datadog agent uses on AWS. The agent component opts in with a token in its own
 * `description`:
 *
 *     hostMetrics:on
 *
 * When present, and the app is gated (enterprise owner + v8), dockerService
 * .appDockerCreate injects HOST_METRIC_MOUNTS (all read-only) plus
 * `HostConfig.CgroupnsMode = 'host'` on THAT component only.
 *
 * This deliberately does NOT grant privileged mode or a shared PID namespace —
 * the standard Datadog agent needs neither (researched; see
 * RESEARCH-datadog-agent-requirements.md):
 *   - docker.sock  → container identity, autodiscovery, Container Map, docker.*
 *   - /host/proc   → host + sibling-container processes (Live Processes), host metrics
 *   - cgroup       → per-container resource metrics (with CgroupnsMode=host)
 *   - /etc/passwd  → process-owner UID→username (optional nicety)
 *
 * The docker socket is host-root-equivalent (read-only is not a boundary), so
 * this is gated to trusted enterprise owners on single-tenant nodes. Remove when
 * v9 (`telemetry` + flux-telemetryd) lands.
 */

const HOST_METRIC_MOUNTS = [
  { Type: 'bind', Source: '/var/run/docker.sock', Target: '/var/run/docker.sock', ReadOnly: true },
  { Type: 'bind', Source: '/proc', Target: '/host/proc', ReadOnly: true },
  { Type: 'bind', Source: '/sys/fs/cgroup', Target: '/host/sys/fs/cgroup', ReadOnly: true },
  { Type: 'bind', Source: '/etc/passwd', Target: '/etc/passwd', ReadOnly: true },
];

/**
 * Whether a component opts into host metric access via `hostMetrics:on` in its
 * description. The literal `:on` (or `=on`) is required so the marker can't be
 * triggered by the words "metrics"/"telemetry" appearing in prose — this grants
 * host-root-equivalent access, so opt-in must be deliberate.
 *
 * @param {string} description - component description text
 * @returns {boolean}
 */
function wantsHostMetrics(description) {
  if (typeof description !== 'string' || !description) {
    return false;
  }
  return /\bhostMetrics\s*[:=]\s*on\b/i.test(description);
}

module.exports = {
  wantsHostMetrics,
  HOST_METRIC_MOUNTS,
};
