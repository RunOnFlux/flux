#!/bin/bash
set -e

ip addr add 169.254.43.43/32 dev lo 2>/dev/null || true

# A default route, or deliberately none - declared by the suite, never inherited
# from the topology.
#
# The harness network is created Internal, so docker gives the container no
# default route at all. FluxOS decides whether this node holds a fixed public
# address by looking for one (fluxNetworkHelper.hasPublicIpOnInterface reads
# /proc/net/route), so left to the wiring EVERY node reads DYNAMIC - which is how
# suite 21's static_ip deferrals silently stopped firing.
#
# This restores the FACT, not connectivity: an internal network's gateway
# forwards nothing outward, so the fleet stays exactly as isolated as Internal
# makes it. Installed here because a node reads its address once during boot -
# anything applied after the fleet is up is never seen.
#
# NOT swallowed. A `|| true` here would make the one failure that matters -
# the route not being installable - look exactly like a node that was never
# asked for one, and the suite would then fail somewhere far away on a
# classification it could not explain.
if [ -n "$FLUX_E2E_DEFAULT_ROUTE" ]; then
  if ! ip route replace default via "$FLUX_E2E_DEFAULT_ROUTE"; then
    echo "ERROR: could not install default route via $FLUX_E2E_DEFAULT_ROUTE;" \
         "this node would read DYNAMIC and any static-IP assertion would fail" >&2
    exit 1
  fi
fi

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

# In stub mode FluxOS only needs somewhere to read an API key from; the calls
# themselves go to the shared stub. In binary mode the config is syncthing's own
# and this fixture must not be in the way of it.
if [ "$FLUX_SYNCTHING_MODE" != "binary" ]; then
  cp /flux/test-infra/fixtures/syncthing-config.xml /dat/usr/lib/syncthing/config.xml 2>/dev/null || true
fi

# Overlay test config into ZelBack/config/ so app.js loads it naturally.
# app.js hardcodes NODE_CONFIG_DIR to ZelBack/config/ (cannot be overridden
# from env — fluxbenchd hashes that directory for tamper detection).
if [ -n "$NODE_CONFIG_DIR" ] && [ -d "$NODE_CONFIG_DIR" ]; then
  cp "$NODE_CONFIG_DIR"/default.js /flux/ZelBack/config/local.js
  cp "$(dirname "$NODE_CONFIG_DIR")/shared.js" /flux/ZelBack/ 2>/dev/null || true
fi

# The runner's own overrides arrive as JSON and are merged OVER the per-node file
# copied above, which is where the per-node database names come from - replacing
# that file rather than merging would take them with it.
#
# They used to arrive as NODE_CONFIG. The config package merges that variable over
# every file whatever directory is pinned, so it could redirect any endpoint
# without touching the directory fluxbenchd hashes - the one change tamper
# detection cannot see. The entry points delete it now, and this carries the same
# content to the same place through a file instead.
if [ -n "$FLUX_TEST_CONFIG" ]; then
  node -e '
    const fs = require("fs");
    const target = "/flux/ZelBack/config/local.js";
    const base = fs.existsSync(target) ? require(target) : {};
    const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v);
    const merge = (a, b) => {
      const out = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = isPlain(v) && isPlain(a[k]) ? merge(a[k], v) : v;
      return out;
    };
    const merged = merge(base, JSON.parse(process.env.FLUX_TEST_CONFIG));
    fs.writeFileSync(target, `module.exports = ${JSON.stringify(merged, null, 2)};\n`);
  '
fi

# The image ships these installed, which is the state a node is in on every boot
# after its first. A suite that wants to exercise the install asks for a node
# without them, and gets one here - before FluxOS starts, so monitorSystem()
# meets the same absence a real first boot does.
#
# Purge, not remove: a removed package leaves its configuration behind and
# dpkg-query reports `deinstall ok config-files`, which is neither installed nor
# absent. getPackageVersion returns '' for that as well as for absent, so the
# node would behave plausibly while sitting in a state no real node is ever in.
if [ "$FLUX_APT_SEEDED" = "false" ]; then
  DEBIAN_FRONTEND=noninteractive apt-get purge -y chrony syncthing netcat-openbsd >/dev/null 2>&1 || true
fi

# A source apt cannot reach, ALONGSIDE the good one rather than instead of it.
# apt-get update then exits non-zero exactly as it does on a real node behind an
# unreachable mirror, an expired key or a DNS blip - while the packages queued
# behind that failure stay installable from the repository the image built, so a
# node that survives the failure still finishes its checks. Replacing the good
# source instead would fail the installs too, and prove only that a broken node
# stays broken.
if [ "$FLUX_APT_BAD_SOURCE" = "true" ]; then
  echo "deb [trusted=yes] file:///opt/flux-apt-repo-does-not-exist ubuntu main" \
    > /etc/apt/sources.list.d/flux-e2e-unreachable.list
fi

# Syncthing listens on apiport+2 in production. The availability checker tests
# that port.
SYNCTHING_LISTEN_PORT=$((${FLUX_API_PORT:-16127} + 2))
if [ "$FLUX_SYNCTHING_MODE" = "binary" ]; then
  # A real daemon, one per node. Nothing here writes syncthing's config: it
  # generates its own identity on first run, which is what gives each node a
  # distinct device id, and FluxOS then sets discovery off, NAT off and
  # listenAddresses to apiport+2 through the API exactly as it does on a node.
  # The endpoint is decided by the runner through the local.js written above,
  # which node-config loads last. No socat either way: whoever
  # starts the daemon, it binds apiport+2 itself.
  #
  # WHO starts it depends on the node type, and SYNCTHING_PATH is the same
  # signal FluxOS reads to decide. Set, FluxOS takes the node for ArcaneOS and
  # leaves supervision to the OS - so the harness stands in for the OS here.
  # Unset, it is a legacy node and FluxOS supervises the daemon itself, so this
  # must keep its hands off or there would be two.
  if [ -n "$SYNCTHING_PATH" ]; then
    # the flags a real Arcane node is supervised with, read off a live one
    mkdir -p /dat/var/log
    nohup syncthing --no-browser --allow-newer-config --home "$SYNCTHING_PATH" \
          --logfile /dat/var/log/syncthing.log --logflags=3 \
          --log-max-old-files=2 --log-max-size=26214400 \
          >/dev/null 2>&1 </dev/null &
  fi
elif [ -n "$FLUX_SYNCTHING_HOST" ]; then
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
