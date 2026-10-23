#!/bin/bash
# The node's network as its suite declares it, built once dockerd is up and before
# FluxOS starts (flux-node-network.service), because a node reads its network at boot.
#
# A named network shape (test-infra/network-shapes.sh) is built after dockerd is up,
# as a VPN comes up after docker on a host: dockerd refuses to start when every
# private range it could give its bridge overlaps a route, and the def1 split routes
# overlap them all. Not swallowed: a shape that failed to build would leave a plain
# static node answering for it.
set -e
if [ -n "${FLUX_E2E_NETWORK_SHAPE:-}" ]; then
  if ! /flux/test-infra/network-shapes.sh "$FLUX_E2E_NETWORK_SHAPE"; then
    echo "ERROR: could not build network shape $FLUX_E2E_NETWORK_SHAPE" >&2
    exit 1
  fi
fi

# A global IPv6 address, declared per node by the suite (createTestEnv globalIpv6). It
# sits on a device of its own with no IPv6 route beyond it, so the node holds a
# routable IPv6 address as a dual-stack host does while every IPv6 connection fails at
# once (ENETUNREACH): an IPv6 that is configured and does not route. Independent of the
# network shape.
if [ -n "${FLUX_E2E_GLOBAL_IPV6:-}" ]; then
  if ! { ip link add flux6 type dummy \
      && sysctl -qw net.ipv6.conf.flux6.disable_ipv6=0 \
      && ip link set flux6 up \
      && ip -6 addr add "$FLUX_E2E_GLOBAL_IPV6/64" dev flux6 nodad; }; then
    echo "ERROR: could not add the global IPv6 address $FLUX_E2E_GLOBAL_IPV6" >&2
    exit 1
  fi
fi
