#!/bin/bash
set -e

ip addr add 169.254.43.43/32 dev lo 2>/dev/null || true

# App installs mount each app's FLUXFSVOL via `mount -o loop`. Loop devices are a
# shared host-kernel resource (not namespaced); the kernel default pool (max_loop,
# typically 8) is small and on-demand creation races under concurrent installs, so a
# fleet installing at once (e.g. instances == nodeCount) exhausts it and installs
# fail with "failed to setup loop device". Pre-create a generous pool so each
# concurrent mount finds a free device. /dev is shared across the privileged nodes,
# so this is idempotent fleet-wide (existing devices are skipped).
for i in $(seq 0 63); do
  [ -e "/dev/loop$i" ] || mknod -m660 "/dev/loop$i" b 7 "$i" 2>/dev/null || true
done

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

# Trust test registry CA for dockerd (Node.js uses NODE_EXTRA_CA_CERTS directly).
# The registry is reached by a stable network alias (fluxregistry), not an IP, so
# this path is base-independent — dockerd pulls fluxregistry:5000/... under any subnet.
if [ -f /usr/local/share/ca-certificates/test-registry.crt ]; then
  mkdir -p "/etc/docker/certs.d/fluxregistry:5000"
  cp /usr/local/share/ca-certificates/test-registry.crt "/etc/docker/certs.d/fluxregistry:5000/ca.crt"
fi

# Start dockerd under a tiny watchdog so it is respawned if it exits. Production
# nodes run dockerd under systemd (which restarts it); this mirrors that and lets
# tests bounce dockerd (kill it) to exercise the reconciler's reconnect/orphan
# recovery without bricking the node. node app.js stays PID 1 (via exec below).
rm -f /var/run/docker.pid
(
  set +e
  while true; do
    rm -f /var/run/docker.pid
    dockerd --data-root /mnt/appdata/docker
    echo "dockerd exited (rc=$?), respawning in 1s" >&2
    sleep 1
  done
) &

TIMEOUT=30
ELAPSED=0
until docker info > /dev/null 2>&1; do
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

# Run FluxOS (CMD ["node","app.js"]) under a respawn watchdog instead of exec'ing it
# as PID 1. This mirrors the dockerd watchdog above and production's systemd: the
# entrypoint shell stays PID 1 and node runs as a child, so a test can kill+respawn
# the FluxOS process (restartFluxos) WITHOUT restarting the container or the inner
# dockerd - the app containers keep running, exactly like `systemctl restart fluxos`.
# The child PID is written to /tmp/fluxos.pid so a test kills only the node process,
# never PID 1. A SIGTERM/SIGINT (docker stop at teardown) stops the child and exits.
set +e
STOPPING=0
trap 'STOPPING=1; kill -TERM "$(cat /tmp/fluxos.pid 2>/dev/null)" 2>/dev/null' TERM INT
while [ "$STOPPING" = "0" ]; do
  "$@" &
  FLUXOS_PID=$!
  echo "$FLUXOS_PID" > /tmp/fluxos.pid
  wait "$FLUXOS_PID"
  [ "$STOPPING" = "1" ] && break
  echo "fluxos (node app.js) exited, respawning in 1s" >&2
  sleep 1
done
