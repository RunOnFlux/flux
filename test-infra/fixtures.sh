#!/usr/bin/env bash
# The harness's fixtures: each directory under test-infra with a build.sh builds
# binaries the suites need, and the repo's .gitignore names each one it builds.
# Derived, never listed, as the image set is.
#
#   fixtures.sh products   # "<fixture dir> <product>" for every product
#   fixtures.sh stale      # fixture dirs with a product missing, or older than a
#                          # tracked file in the dir (a changed recipe or source)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

products() {
  local dir
  for build in $(find test-infra -name build.sh -not -path '*/node_modules/*' | sort); do
    dir="${build%/build.sh}"
    grep -E "^${dir}/[^/]+$" .gitignore | while read -r product; do echo "$dir $product"; done
  done
}

stale() {
  local dir product newest
  products | while read -r dir product; do
    if [ ! -e "$product" ]; then echo "$dir"; continue; fi
    newest="$(git ls-files -z "$dir" | xargs -0 ls -t 2>/dev/null | head -1)"
    if [ -n "$newest" ] && [ "$newest" -nt "$product" ]; then echo "$dir"; fi
  done | sort -u
}

case "${1:-}" in
  products) products ;;
  stale) stale ;;
  *) echo "usage: $0 products|stale" >&2; exit 2 ;;
esac
