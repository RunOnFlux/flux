#!/usr/bin/env bash
# Compile the configurable test-app to a small static linux/amd64 binary.
# Output: test-infra/test-app/test-app (gitignored) — read by registry-helper.
#
#   bash test-infra/test-app/build.sh
#
# Uses an Alpine (musl) builder so the static binary is tens of KB.
#
# Rebuilds only when test-app.c has actually changed, keyed on a hash of the
# source rather than on the binary merely existing or on mtimes. Both of the
# cheaper checks are wrong here: the binary is gitignored, so it survives a
# branch switch, and test-app.c genuinely differs between lineages — an
# existence check would then run one branch's tests against another branch's
# binary. On CI the binary is never present (checkout runs git clean), so this
# always compiles there, which is the intent.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  fi
  # no hasher: prints nothing, and an empty hash never matches, so we rebuild
}

want="$(source_hash "$here/test-app.c")"
stamp="$here/test-app.sha256"

if [ -n "$want" ] && [ -f "$here/test-app" ] && [ -f "$stamp" ] && [ "$want" = "$(cat "$stamp")" ]; then
  echo "test-app is current for this test-app.c ($(wc -c < "$here/test-app") bytes) — not rebuilding"
  exit 0
fi

docker run --rm --platform linux/amd64 -v "$here:/src" -w /src alpine:3 \
  sh -c 'apk add --no-cache gcc musl-dev >/dev/null && gcc -static -Os -o test-app test-app.c && strip test-app'

[ -n "$want" ] && printf '%s' "$want" > "$stamp"

echo "built $here/test-app ($(wc -c < "$here/test-app") bytes)"
