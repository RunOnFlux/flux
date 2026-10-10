#!/usr/bin/env bash
# Extract a static busybox (linux/amd64) for app containers a suite needs tools
# inside: inspecting injected files (`docker exec <container> /bin/busybox
# cat|stat`) or probing the network from an app (wget, nc, ping). The harness's
# other fixtures — /bin/pause, /bin/test-app — are freestanding, with no tools
# to exec. Output: test-infra/busybox-fixture/busybox (gitignored),
# pushed to the harness registry by registry-helper.pushBusybox.
#
#   bash test-infra/busybox-fixture/build.sh
#
# Run once during bootstrap; rebuild only if the busybox version needs bumping.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

docker run --rm --platform linux/amd64 -v "$here:/out" alpine:3 \
  sh -c 'apk add --no-cache busybox-static >/dev/null && cp /bin/busybox.static /out/busybox && chmod 0755 /out/busybox'

echo "built $here/busybox ($(wc -c < "$here/busybox") bytes)"
