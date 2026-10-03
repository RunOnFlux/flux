#!/bin/bash
# Builds one named network shape in this node's namespace before FluxOS starts.
#
#   network-shapes.sh <shape>
#
# Reads FLUX_NODE_IP (this node's address) and FLUX_E2E_DEFAULT_ROUTE (the
# fleet gateway, present because the shapes start from a node declared static).
# The node keeps its address on the fleet device throughout, so it still
# reaches every peer and stub over the subnet's own route; each shape changes
# only where traffic for the internet leaves.
#
#   private-egress      traffic leaves by a device holding only a private address
#   alias               the node's address is bound under the label <dev>:1
#   idle-tunnel         a WireGuard device with an address and no routes, as a
#                       Tailscale or ZeroTier link used only for SSH
#   wg-full-tunnel      wg-quick with AllowedIPs 0.0.0.0/0: a default route in
#                       table 51820, chosen by policy rules; the main table's
#                       default stays on the fleet device
#   def1-tunnel         OpenVPN redirect-gateway def1: 0.0.0.0/1 and
#                       128.0.0.0/1 over a tunnel device, no default route
#   no-gateway-default  a default route straight to the device, with no
#                       gateway, as pppd installs one
set -euo pipefail

shape="$1"
: "${FLUX_NODE_IP:?}" "${FLUX_E2E_DEFAULT_ROUTE:?}"

dev=$(ip -o -4 addr show | awk -v ip="$FLUX_NODE_IP" '{ split($4, a, "/"); if (a[1] == ip) print $2 }')
prefix=$(ip -o -4 addr show dev "$dev" | awk -v ip="$FLUX_NODE_IP" '{ split($4, a, "/"); if (a[1] == ip) print a[2] }')
[ -n "$dev" ] && [ -n "$prefix" ] || { echo "network-shapes: $FLUX_NODE_IP is on no device" >&2; exit 1; }

case "$shape" in
  private-egress)
    ip link add dummy0 type dummy
    ip addr add 192.168.77.2/24 dev dummy0
    ip link set dummy0 up
    ip route replace default via 192.168.77.1 dev dummy0
    ;;
  alias)
    # Deleting the address takes the routes through it, so both come back.
    ip addr del "$FLUX_NODE_IP/$prefix" dev "$dev"
    ip addr add "$FLUX_NODE_IP/$prefix" dev "$dev" label "$dev:1"
    ip route replace default via "$FLUX_E2E_DEFAULT_ROUTE" dev "$dev"
    ;;
  idle-tunnel)
    ip link add tailscale0 type wireguard
    ip addr add 100.64.0.2/32 dev tailscale0
    ip link set tailscale0 up
    ;;
  wg-full-tunnel)
    ip link add wg0 type wireguard
    ip addr add 10.66.0.2/32 dev wg0
    ip link set wg0 up
    ip route add default dev wg0 table 51820
    ip rule add not fwmark 51820 table 51820 priority 100
    ip rule add table main suppress_prefixlength 0 priority 99
    ;;
  def1-tunnel)
    ip link add wg1 type wireguard
    ip addr add 10.8.0.2/24 dev wg1
    ip link set wg1 up
    ip route add 0.0.0.0/1 dev wg1
    ip route add 128.0.0.0/1 dev wg1
    ;;
  no-gateway-default)
    ip route replace default dev "$dev"
    ;;
  *)
    echo "network-shapes: unknown shape '$shape'" >&2
    exit 1
    ;;
esac
