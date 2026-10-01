#!/bin/sh
# Starts a node's own syncthing the way the OS does on an Arcane node: detached,
# out of $SYNCTHING_PATH, with the flags a live node is supervised with, and in a
# mount namespace of its own with the numeric id tables the image carries bound
# over /etc/passwd and /etc/group, as the unit's BindReadOnlyPaths gives it. The
# entrypoint runs it at boot in binary mode, and a suite that stopped the daemon
# (as the OS does after FluxOS on a shutdown) runs it to bring the daemon back.
mkdir -p /dat/var/log
nohup unshare --mount --propagation slave sh -c \
      'mount --bind "$1" /etc/passwd && mount --bind "$2" /etc/group && shift 2 && exec syncthing "$@"' syncthing \
      /usr/lib/syncthing/passwd /usr/lib/syncthing/group \
      --no-browser --allow-newer-config --home "${SYNCTHING_PATH:-/dat/usr/lib/syncthing}" \
      --logfile /dat/var/log/syncthing.log --logflags=3 \
      --log-max-old-files=2 --log-max-size=26214400 \
      >/dev/null 2>&1 </dev/null &
