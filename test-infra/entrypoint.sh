#!/bin/bash
set -e

ip addr add 169.254.43.43/32 dev lo 2>/dev/null || true

mkdir -p /dat/var/lib/fluxd \
         /dat/usr/lib/syncthing \
         /dat/usr/lib/fluxbenchd \
         /dat/usr/lib/fluxwatchdog \
         /mnt/appdata/flux-apps

cp /flux/test-infra/fixtures/syncthing-config.xml /dat/usr/lib/syncthing/config.xml 2>/dev/null || true

# Overlay test config into ZelBack/config/ so app.js loads it naturally.
# app.js hardcodes NODE_CONFIG_DIR to ZelBack/config/ (cannot be overridden
# from env — fluxbenchd hashes that directory for tamper detection).
if [ -n "$NODE_CONFIG_DIR" ] && [ -d "$NODE_CONFIG_DIR" ]; then
  cp "$NODE_CONFIG_DIR"/default.js /flux/ZelBack/config/local.js
  cp "$(dirname "$NODE_CONFIG_DIR")/shared.js" /flux/ZelBack/ 2>/dev/null || true
fi

if [ "$FLUX_DISCOVERY_AUTOSTART" = "true" ]; then
  sed -i 's/discoveryAutostart: false/discoveryAutostart: true/' /flux/ZelBack/shared.js
fi

# Syncthing listens on apiport+2 in production. The availability checker
# tests this port. Forward it to the syncthing stub's API port.
SYNCTHING_LISTEN_PORT=$((${FLUX_API_PORT:-16127} + 2))
if [ -n "$FLUX_SYNCTHING_HOST" ]; then
  socat TCP-LISTEN:${SYNCTHING_LISTEN_PORT},fork,reuseaddr TCP:${FLUX_SYNCTHING_HOST}:${FLUX_SYNCTHING_PORT:-8384} &
fi

# cgroup v2: move existing processes to an init sub-cgroup so dockerd
# can enable subtree controllers (same approach as official docker:dind)
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  mkdir -p /sys/fs/cgroup/init
  xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || :
  sed -e 's/ / +/g' -e 's/^/+/' < /sys/fs/cgroup/cgroup.controllers \
      > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || :
fi

# Trust test registry CA if present
if [ -f /usr/local/share/ca-certificates/test-registry.crt ]; then
  update-ca-certificates 2>/dev/null || true
  mkdir -p "/etc/docker/certs.d/198.18.0.5:5000"
  cp /usr/local/share/ca-certificates/test-registry.crt "/etc/docker/certs.d/198.18.0.5:5000/ca.crt"
fi

# Start dockerd (FluxOS expects Docker on the local socket)
rm -f /var/run/docker.pid
dockerd --data-root /mnt/appdata/docker &
DOCKERD_PID=$!

TIMEOUT=30
ELAPSED=0
until docker info > /dev/null 2>&1; do
  if ! kill -0 "$DOCKERD_PID" 2>/dev/null; then
    echo "ERROR: dockerd exited unexpectedly" >&2
    exit 1
  fi
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "ERROR: dockerd failed to start within ${TIMEOUT}s" >&2
    exit 1
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done
echo "dockerd is ready (took ${ELAPSED}s)"

# Write boot_id for test harness control.
# FLUX_BOOT_ID is set per-container by the test harness.
# The harness seeds a heartbeat with matching or different value to
# control machineRebooted detection in readBootContext().
if [ -n "$FLUX_BOOT_ID" ]; then
  echo "$FLUX_BOOT_ID" > /tmp/flux-boot-id
fi

exec "$@"
