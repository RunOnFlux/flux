#!/bin/bash
set -e

ip addr add 169.254.43.43/32 dev lo 2>/dev/null || true

exec "$@"
