#!/usr/bin/env bash
# Prints the digest of the sources an image is built from.
#
# An image name is fixed but its contents are not, and nothing else ties a built
# image to the tree it came from. A stub rebuilt on another branch, or simply not
# rebuilt after its source moved, runs against this branch's suites and fails
# looking like a product bug - suites 87/88/90 died in a `before each` calling a
# stub endpoint the image did not carry, which reads as a restore defect and is
# not one. Stamping this digest at build time and comparing it before a run turns
# that into a refusal with a name on it.
#
# The digest covers the BUILD CONTEXT, not a marker someone remembered to add:
# a marker proves one line, and picking one per change is the same memory test
# that fails in the first place.
#
#   usage: image-digest.sh fluxos-01 | image-digest.sh <stub-dir-name>
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if command -v sha256sum >/dev/null 2>&1; then HASH=sha256sum; else HASH="shasum -a 256"; fi

# Hash every file under the given roots, path included, order fixed. LC_ALL=C so
# the sort is byte order on any host, and -print0/-0 so a path with a space in it
# cannot split a filename into two. An empty result is a failure, not a digest:
# this refuses runs, so it must never hand back something that merely looks like
# an answer.
digest_roots() {
  local out
  out="$(find "$@" -type f -print0 2>/dev/null \
    | LC_ALL=C sort -z \
    | xargs -0 -r $HASH \
    | $HASH | cut -d' ' -f1)"
  [ -n "$out" ] || { echo "image-digest: hashed nothing under: $*" >&2; return 3; }
  printf '%s\n' "$out"
}

# fluxos-01 is built with `COPY . .` from the repo root, so its context is every
# top-level entry .dockerignore does not exclude. Derived from the file rather
# than restated here: a new exclusion would otherwise change what docker bakes
# without changing what this measures.
fluxos_roots() {
  local ignore=() line entry skip i
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="$(printf '%s' "$line" | tr -d '[:space:]')"
    [ -n "$line" ] && ignore+=("$line")
  done < .dockerignore

  for entry in * .[!.]*; do
    [ -e "$entry" ] || continue
    skip=0
    for i in "${ignore[@]:-}"; do [ "$entry" = "$i" ] && skip=1; done
    [ "$skip" -eq 0 ] && printf '%s\n' "$entry"
  done
}

image="${1:?usage: image-digest.sh <fluxos-01|stub-dir-name>}"

if [ "$image" = "fluxos-01" ]; then
  roots=()
  while IFS= read -r entry; do roots+=("$entry"); done < <(fluxos_roots)
  [ "${#roots[@]}" -gt 0 ] || { echo "image-digest: empty build context" >&2; exit 3; }
  digest_roots "${roots[@]}"
  exit 0
fi

dir="test-infra/$image"
[ -d "$dir" ] || { echo "image-digest: no such image source: $dir" >&2; exit 2; }

# A stub that builds FROM the node image inherits its contents, so a stale
# fluxos-01 makes the stub stale too even when its own directory has not moved.
# external-http-stub is the one that does this today; the ARG is what says so.
if grep -q 'FLUX_E2E_TAG' "$dir/Dockerfile" 2>/dev/null; then
  base="$("$0" fluxos-01)" || exit 3
  own="$(digest_roots "$dir")" || exit 3
  printf '%s\n%s\n' "$own" "$base" | $HASH | cut -d' ' -f1
else
  digest_roots "$dir"
fi
