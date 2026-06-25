#!/usr/bin/env bash
# Compile the configurable test-app to a small static linux/amd64 binary.
# Output: test-infra/test-app/test-app (gitignored) — read by registry-helper.
# Run once during bootstrap, and again whenever test-app.c changes.
#
#   bash test-infra/test-app/build.sh
#
# Uses an Alpine (musl) builder so the static binary is tens of KB.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

docker run --rm --platform linux/amd64 -v "$here:/src" -w /src alpine:3 \
  sh -c 'apk add --no-cache gcc musl-dev >/dev/null && gcc -static -Os -o test-app test-app.c && strip test-app'

echo "built $here/test-app ($(wc -c < "$here/test-app") bytes)"
