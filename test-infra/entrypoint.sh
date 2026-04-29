#!/bin/bash
set -e

ip addr add 169.254.43.43/32 dev lo 2>/dev/null || true

mkdir -p /dat/var/lib/fluxd \
         /dat/usr/lib/syncthing \
         /dat/usr/lib/fluxbenchd \
         /dat/usr/lib/fluxwatchdog \
         /dat/var/lib/fluxos/flux-apps

exec "$@"
