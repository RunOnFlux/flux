#!/bin/bash
# ensure-upgrade-bases.sh <suite file>...
#
# Builds, one at a time, the node image each named suite starts its upgraded nodes on
# (framework/upgrade-base.js) where this host has none. Exits 0 once every one is on
# the host, 2 when a suite's release cannot be resolved, 3 when a build fails.
set -uo pipefail

cd "$(dirname "$0")" || exit 99

bases=$(node framework/upgrade-base.js "$@") || exit 2
[ -n "$bases" ] || exit 0

# one build at a time on a host, whichever run asks
exec 9>/tmp/e2e-upgrade-base.lock
flock 9

while IFS=$'\t' read -r file declared ref tag; do
  docker image inspect "flux-e2e-fluxos-01:$tag" >/dev/null 2>&1 && continue
  echo "ensure-upgrade-bases: building flux-e2e-fluxos-01:$tag from $ref ($declared, for $(basename "$file"))"
  if ! FLUX_E2E_TAG="$tag" ../build-release-image.sh "$ref"; then
    echo "ensure-upgrade-bases: the build of $ref failed"
    exit 3
  fi
done <<< "$bases"
