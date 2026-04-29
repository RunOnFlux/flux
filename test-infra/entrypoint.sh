#!/bin/bash
set -e

ip addr add 169.254.43.43/32 dev lo 2>/dev/null || true

mkdir -p /dat/var/lib/fluxd \
         /dat/usr/lib/syncthing \
         /dat/usr/lib/fluxbenchd \
         /dat/usr/lib/fluxwatchdog \
         /mnt/appdata/flux-apps

cp /flux/test-infra/fixtures/syncthing-config.xml /dat/usr/lib/syncthing/config.xml 2>/dev/null || true

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

# Start dockerd (FluxOS expects Docker on the local socket)
dockerd &
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

exec "$@"
