#!/bin/bash
set -e

ip addr add 169.254.43.43/32 dev lo 2>/dev/null || true

# Every mount shared, as systemd makes them at boot on a real host. syncthing
# runs in a mount namespace that is a slave of the node's, and a slave receives
# the app volumes FluxOS mounts after syncthing starts only from a shared mount.
mount --make-rshared /

# A default route, or deliberately none - declared by the suite, never inherited
# from the topology.
#
# The harness network is created Internal, so docker gives the container no
# default route at all. FluxOS decides whether this node holds a fixed public
# address by asking which device its internet traffic leaves by
# (fluxNetworkHelper.hasPublicIpOnInterface), so left to the wiring there is no
# such device, EVERY node reads UNKNOWN, and suite 21's static_ip deferrals
# never fire.
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
         "this node would not read STATIC and any static-IP assertion would fail" >&2
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
# A node whose discovery the harness has started rejoins the mesh by itself on
# every later start, the run's own discoveryAutostart notwithstanding.
node /flux/test-infra/rejoin-discovery.cjs apply

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

# A firewalled node boots with ufw active as its install leaves it, before
# dockerd and FluxOS start, so FluxOS meets an active firewall and adds its own
# rules on top exactly as it does on a node.
#
# Legacy: fluxnode-multitool install_pro.sh, rule for rule, with this node's ssh
# port (22). Arcane: the ISO (flux_iso flux_fs/conf/user.rules - ufw's stock
# policies and a limit on OpenSSH) plus the FluxadmSSH profile flux_configd
# writes (config_builder.py, FluxadmSshUfwConfig), which FluxOS then allows.
# flux_configd's own runtime rules - its config webserver, the app profiles it
# manages and the SSDP reply rule behind NAT - are not reproduced: nothing here
# runs flux_configd.
#
# The OpenSSH profile comes with openssh-server. The ISO ships it, so an Arcane
# node gets the profile the package installs. The legacy installer's
# `ufw limit OpenSSH` fails silently where openssh-server is absent, so a legacy
# node carries that rule only when the profile exists.
#
# NOT swallowed: a node that should be firewalled and is not would pass every
# assertion about a firewall it does not have.
if [ "$FLUX_FIREWALL" = "true" ]; then
  if [ -n "$FLUXOS_PATH" ]; then
    cat > /etc/ufw/applications.d/openssh-server <<PROFILE
[OpenSSH]
title=Secure shell server, an rshd replacement
description=OpenSSH is a free implementation of the Secure Shell protocol.
ports=22/tcp
PROFILE
    cat > /etc/ufw/applications.d/fluxadm-ssh <<PROFILE
[FluxadmSSH]
title=Fluxadm admin ssh port
description=Temporary debug port until we get decent error reporting
ports=$((${FLUX_API_PORT:-16127} - 5))/tcp
PROFILE
    ufw_baseline="logging low
limit OpenSSH"
  else
    ufw_baseline="allow 22/tcp
logging on
default deny incoming
allow out from any to any port 123
allow out to any port 80
allow out to any port 443
allow out to any port 53
allow 16100:16199/tcp"
    if [ -f /etc/ufw/applications.d/openssh-server ]; then
      ufw_baseline="$ufw_baseline
limit OpenSSH"
    fi
  fi
  while IFS= read -r rule; do
    # shellcheck disable=SC2086
    if ! ufw $rule >/dev/null; then
      echo "ERROR: ufw $rule failed; this node would boot without the firewall it was asked for" >&2
      exit 1
    fi
  done <<< "$ufw_baseline"
  if ! ufw --force enable >/dev/null; then
    echo "ERROR: ufw would not enable; this node would boot without the firewall it was asked for" >&2
    exit 1
  fi
fi

# cgroup v2: move this container's processes into an init sub-cgroup so the root
# can hand its controllers down (same approach as official docker:dind). A group
# holding processes is refused permission to delegate, so the move has to leave
# the root empty and nothing may start into it afterwards - which is why this runs
# before anything is put in the background below.
#
# Verified rather than attempted. Without `memory` delegated, every container
# docker creates here is missing memory.max and cannot start, and the node says
# nothing about it: it boots looking healthy and fails every app it is ever given.
# Refusing the boot is the smaller fault, and names itself.
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  mkdir -p /sys/fs/cgroup/init
  for attempt in 1 2 3; do
    xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || :
    sed -e 's/ / +/g' -e 's/^/+/' < /sys/fs/cgroup/cgroup.controllers \
        > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || :
    if grep -qw memory /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null; then
      break
    fi
    echo "cgroup delegation not in effect (attempt ${attempt}), retrying" >&2
    sleep 1
  done
  if ! grep -qw memory /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null; then
    echo "ERROR: cgroup v2 root still holds $(wc -l < /sys/fs/cgroup/cgroup.procs) process(es)" >&2
    echo "ERROR: memory is not delegated, so no app container on this node can start" >&2
    exit 1
  fi
fi

# Syncthing listens on apiport+2 in production. The availability checker tests
# that port. In systemd mode the stub forward runs as a unit instead
# (syncthing-forward.service), so systemd supervises it like everything else.
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
  # WHO starts it is the complement of FluxOS's own rule, which is that it
  # supervises a syncthing that is on this host and not Arcane. Binary mode is
  # the on-this-host half - the runner points the node at 127.0.0.1 for exactly
  # these nodes - so what is left to decide here is the Arcane half. Set, FluxOS
  # stands back and the OS supervises the daemon, and the harness stands in for
  # the OS. Unset, FluxOS supervises it itself and this must keep its hands off
  # or the node gets two.
  #
  # The two must stay complements. Answer this from a signal FluxOS does not
  # read and a node with one of them gets either two syncthings or none.
  if [ -n "$FLUXOS_PATH" ]; then
    # the flags a real Arcane node is supervised with, read off a live one
    /flux/test-infra/start-syncthing.sh
  fi
elif [ -n "$FLUX_SYNCTHING_HOST" ] && [ "$FLUX_SYSTEMD_MODE" != "true" ]; then
  socat TCP-LISTEN:${SYNCTHING_LISTEN_PORT},fork,reuseaddr TCP:${FLUX_SYNCTHING_HOST}:${FLUX_SYNCTHING_PORT:-8384} &
fi

# Trust test registry CA for dockerd (Node.js uses NODE_EXTRA_CA_CERTS directly).
# The registry is reached by a stable network alias (fluxregistry), not an IP, so
# this path is base-independent — dockerd pulls fluxregistry:5000/... under any subnet.
if [ -f /usr/local/share/ca-certificates/test-registry.crt ]; then
  mkdir -p "/etc/docker/certs.d/fluxregistry:5000"
  cp /usr/local/share/ca-certificates/test-registry.crt "/etc/docker/certs.d/fluxregistry:5000/ca.crt"
fi

# Write boot_id for test harness control.
# FLUX_BOOT_ID is set per-container by the test harness.
# The harness seeds a heartbeat with matching or different value to
# control machineRebooted detection in readBootContext().
if [ -n "$FLUX_BOOT_ID" ]; then
  echo "$FLUX_BOOT_ID" > /tmp/flux-boot-id
fi

# ── systemd mode (opt-in) ──────────────────────────────────────────────────
# The node runs a real systemd as PID 1: dockerd and fluxos become units, as
# they are on a production host, and anything FluxOS manages through systemctl
# behaves as it does there. Everything below this block is the default path
# and is unreachable in this mode; the fault-injection lever that lives there
# (/tmp/fluxos.pid — restartFluxos) does not exist under systemd, and
# framework/systemd-control.js holds the equivalents.
if [ "$FLUX_SYSTEMD_MODE" = "true" ]; then
  # fluxos.service runs FluxOS as root. An unprivileged node is a different
  # install shape, and booting it as root would test the wrong one.
  if [ -n "$FLUX_FLUXOS_USER" ]; then
    echo "[entrypoint] FATAL: systemd mode runs FluxOS as root; FLUX_FLUXOS_USER=$FLUX_FLUXOS_USER is not supported here" >&2
    exit 1
  fi

  # The Ubuntu base image's policy-rc.d refuses every service start a package
  # install asks for. A host has none, so a package installed here starts its
  # service as it does on a node.
  rm -f /usr/sbin/policy-rc.d

  # Container env does not cross into systemd services (the manager
  # environment arrives empty), so dump it for the
  # units' EnvironmentFile. node writes C-style-quoted values, which keeps
  # NODE_CONFIG's embedded JSON quoting intact.
  node -e '
    const fs = require("fs");
    const skip = new Set(["PATH", "HOSTNAME", "HOME", "PWD", "OLDPWD", "SHLVL", "TERM", "SHELL", "_", "DEBIAN_FRONTEND", "LS_COLORS"]);
    const lines = Object.entries(process.env)
      .filter(([k]) => !skip.has(k))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    fs.writeFileSync("/etc/fluxos-harness.env", lines.join("\n") + "\n");
  '

  cp /flux/test-infra/systemd/*.service /etc/systemd/system/
  mkdir -p /etc/systemd/system/multi-user.target.wants
  ln -sf /etc/systemd/system/dockerd.service /etc/systemd/system/multi-user.target.wants/dockerd.service
  ln -sf /etc/systemd/system/fluxos.service /etc/systemd/system/multi-user.target.wants/fluxos.service
  if [ -n "$FLUX_SYNCTHING_HOST" ]; then
    ln -sf /etc/systemd/system/syncthing-forward.service /etc/systemd/system/multi-user.target.wants/syncthing-forward.service
  fi

  # Container hygiene: kernel modules cannot be loaded here, and a tmpfs
  # over /tmp would shadow the harness's /tmp/flux-boot-config bind mount.
  # kernel.*, fs.*, vm.* and binfmt_misc are the host's, not the container's,
  # and a privileged node can write them: systemd-sysctl and systemd-binfmt
  # would apply the image's settings to the shared runner host.
  ln -sf /dev/null /etc/systemd/system/systemd-modules-load.service
  ln -sf /dev/null /etc/systemd/system/systemd-sysctl.service
  ln -sf /dev/null /etc/systemd/system/systemd-binfmt.service
  ln -sf /dev/null /etc/systemd/system/tmp.mount

  # docker-ce's packaged containerd.service would boot under systemd and
  # dockerd then prefers it — with its snapshotter on the overlayfs root
  # (EINVAL on overlay-on-overlay). Masked, dockerd spawns its own
  # containerd under the data-root, exactly like the default mode.
  ln -sf /dev/null /etc/systemd/system/containerd.service

  # docker-ce's own docker.service and docker.socket start a second dockerd on
  # the same daemon.json. It takes the volume store's lock, then waits for the
  # masked containerd, and dockerd.service can never open the store. Masked,
  # dockerd.service is the node's only daemon.
  ln -sf /dev/null /etc/systemd/system/docker.service
  ln -sf /dev/null /etc/systemd/system/docker.socket

  # The default mode's data-root, in the file the dockerd unit reads its
  # configuration from.
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<EOF
{
  "data-root": "/mnt/appdata/docker"
}
EOF

  # The handoff marker. Everything above runs as PID 1's shell, whose output IS the
  # container's stdout; everything after it belongs to systemd, whose output is not.
  # So a container that died with this line in `docker logs` failed under systemd (read
  # its journal), and one that died WITHOUT it failed in the setup above, where the
  # failing command's own stderr is the diagnosis.
  # systemd's FIRST act is to create an inotify instance to watch cgroups, and
  # fs.inotify.max_user_instances is a PER-UID, HOST-WIDE pool that every container
  # on the box draws from as root. Exhaust it and systemd cannot allocate its manager
  # object and PID 1 exits 255 — having written the reason to /dev/console, which a
  # container without a TTY does not have. That is total silence: no docker logs, no
  # journal (journald never started), nothing.
  #
  # So ask the question here, where the answer can be printed. node is in this image;
  # fs.watch allocates exactly the resource systemd is about to need.
  if ! node -e 'const w=require("fs").watch("/tmp",()=>{}); w.close();' 2>/dev/null; then
    echo "[entrypoint] FATAL: cannot allocate an inotify instance — systemd will exit 255." >&2
    echo "[entrypoint] fs.inotify.max_user_instances=$(cat /proc/sys/fs/inotify/max_user_instances 2>/dev/null) is a HOST-WIDE per-uid pool" >&2
    echo "[entrypoint] shared by every container on this box. Raise it on the HOST, not here." >&2
    exit 3
  fi
  echo "[entrypoint] setup complete, handing off to systemd as pid 1"
  # journal-or-kmsg, not the default: systemd's own messages go to the journal once
  # journald exists, and to the KERNEL RING BUFFER before it does — which is the exact
  # window a boot failure happens in. The default target leaves that window writing to
  # /dev/console, and a container without a TTY has none, so a systemd that dies before
  # journald is completely mute. The fallback only fires when the journal is
  # unavailable, so a healthy boot writes nothing to kmsg.
  exec /lib/systemd/systemd --log-target=journal-or-kmsg
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

# A named network shape (test-infra/network-shapes.sh), declared per node by the
# suite, built before FluxOS starts because a node reads its network at boot.
# Built after dockerd is up, as a VPN comes up after docker on a host: dockerd
# refuses to start when every private range it could give its bridge overlaps a
# route, and the def1 split routes overlap them all. Not swallowed, for the
# reason given for the default route: a shape that failed to build would leave a
# plain static node answering for it.
if [ -n "${FLUX_E2E_NETWORK_SHAPE:-}" ]; then
  if ! /flux/test-infra/network-shapes.sh "$FLUX_E2E_NETWORK_SHAPE"; then
    echo "ERROR: could not build network shape $FLUX_E2E_NETWORK_SHAPE" >&2
    exit 1
  fi
fi

# A global IPv6 address, declared per node by the suite (createTestEnv globalIpv6). It sits on
# a device of its own with no IPv6 route beyond it, so the node holds a routable IPv6 address
# as a dual-stack host does while every IPv6 connection fails at once (ENETUNREACH): an IPv6
# that is configured and does not route. Independent of the network shape, and built before
# FluxOS starts for the same reason.
if [ -n "${FLUX_E2E_GLOBAL_IPV6:-}" ]; then
  if ! { ip link add flux6 type dummy \
      && sysctl -qw net.ipv6.conf.flux6.disable_ipv6=0 \
      && ip link set flux6 up \
      && ip -6 addr add "$FLUX_E2E_GLOBAL_IPV6/64" dev flux6 nodad; }; then
    echo "ERROR: could not add the global IPv6 address $FLUX_E2E_GLOBAL_IPV6" >&2
    exit 1
  fi
fi

# WHO FLUXOS RUNS AS. Root unless the fleet names an account, which is the Arcane
# node; named, it is the unprivileged install - FluxOS as the user the operator
# installed it as, with passwordless sudo for everything privileged.
#
# What that account owns is decided here rather than in the image, because it is
# per-node: the tree FluxOS writes into, its logs, and the apps folder, which on an
# unprivileged node belongs to the operator. Nothing else changes hands - dockerd,
# syncthing and every app volume stay root's, and that is what makes the node's own
# reads refusable, exactly as a container's mount point is on a real node.
#
# setpriv rather than sudo: this node's environment IS its configuration, and sudo
# rebuilds the environment it passes on. HOME travels with the account because a
# legacy node derives its flux directory from it.
if [ -n "$FLUX_FLUXOS_USER" ]; then
  FLUXOS_UID="$(id -u "$FLUX_FLUXOS_USER")"
  FLUXOS_GID="$(id -g "$FLUX_FLUXOS_USER")"
  HOME="$(getent passwd "$FLUX_FLUXOS_USER" | cut -d: -f6)"
  export HOME
  # The apps folder only. The install itself already belongs to this account, from
  # the image - a recursive chown of it here would copy the whole tree up into the
  # overlay and outlast the node's readiness window.
  chown "$FLUXOS_UID:$FLUXOS_GID" "${FLUX_APPS_FOLDER:-/mnt/appdata/flux-apps}"
  set -- setpriv --reuid="$FLUXOS_UID" --regid="$FLUXOS_GID" --init-groups "$@"
fi

# Run FluxOS (CMD ["node","app.js"]) under a respawn watchdog instead of exec'ing it
# as PID 1. This mirrors the dockerd watchdog above and production's systemd: the
# entrypoint shell stays PID 1 and node runs as a child, so a test can kill+respawn
# the FluxOS process (restartFluxos) WITHOUT restarting the container or the inner
# dockerd - the app containers keep running, exactly like `systemctl restart fluxos`.
# The child PID is written to /tmp/fluxos.pid so a test kills only the node process,
# never PID 1. A SIGTERM/SIGINT (docker stop at teardown) stops the child and exits.
#
# While /tmp/fluxos.hold exists the loop does not respawn: the node stays down
# after FluxOS exits, as a machine does between a shutdown and its next boot,
# and comes back once a test removes the file.
# A legacy node the multitool installed: the pm2 daemon starts FluxOS through
# start.sh, which runs npm start - npm install, then FluxOS - from the account's
# home, with the flags the multitool gives it. The kill timeout is the fleet's
# to choose; unset, pm2 uses its own default. There is no registry here, so npm
# answers its install from the image's own. The entrypoint stays in the
# foreground streaming pm2's logs, so FluxOS's output is the container's, and a
# test stops and starts FluxOS through pm2 as an operator or the OS does.
if [ "$FLUX_PM2" = "1" ]; then
  export NPM_CONFIG_OFFLINE=true NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_UPDATE_NOTIFIER=false
  cd "$HOME" || exit 1
  pm2 start "$HOME/zelflux/start.sh" --name flux \
    --max-memory-restart 1500M --restart-delay 30000 --max-restarts 40 --time \
    ${FLUX_PM2_KILL_TIMEOUT_MS:+--kill-timeout "$FLUX_PM2_KILL_TIMEOUT_MS"} >/dev/null
  trap 'pm2 kill >/dev/null 2>&1; exit 0' TERM INT
  pm2 logs --raw --lines 0 &
  wait $!
  exit 0
fi

set +e
STOPPING=0
trap 'STOPPING=1; kill -TERM "$(cat /tmp/fluxos.pid 2>/dev/null)" 2>/dev/null' TERM INT
while [ "$STOPPING" = "0" ]; do
  "$@" &
  FLUXOS_PID=$!
  echo "$FLUXOS_PID" > /tmp/fluxos.pid
  wait "$FLUXOS_PID"
  [ "$STOPPING" = "1" ] && break
  while [ -f /tmp/fluxos.hold ] && [ "$STOPPING" = "0" ]; do sleep 1; done
  [ "$STOPPING" = "1" ] && break
  echo "fluxos (node app.js) exited, respawning in 1s" >&2
  sleep 1
done
