#!/bin/bash
# Builds a node image whose FluxOS is another ref's product code inside this tree's
# harness - the stubs, entrypoint and runner a fleet of this tree boots with - so a
# suite can boot a node on a released FluxOS and upgrade it in place to this tree's.
#
#   FLUX_E2E_TAG=<tag> ./test-infra/build-release-image.sh <git ref>
#
# The ref must be in this clone. Builds fluxos-01 only, stamped like any other
# (build-images.sh), from a temporary worktree of HEAD with the product paths
# taken from the ref and the per-node configs generated from the ref's own config.
# The gitignored build products the image needs are copied from this clone.
set -euo pipefail

REF=${1:?usage: FLUX_E2E_TAG=<tag> $0 <git ref>}
: "${FLUX_E2E_TAG:?FLUX_E2E_TAG names the tag to build under}"
CLONE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRODUCT=(ZelBack helpers lib app.js apiServer.js init.js package.json)

git -C "$CLONE" rev-parse --verify --quiet "$REF^{commit}" >/dev/null || { echo "build-release-image: $REF is not in this clone" >&2; exit 2; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/flux-release-image.XXXXXX")
cleanup() {
  git -C "$CLONE" worktree remove --force "$WORK/tree" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

git -C "$CLONE" worktree add --quiet --detach "$WORK/tree" HEAD
cd "$WORK/tree"

for p in "${PRODUCT[@]}"; do
  rm -rf "$p"
  git archive "$REF" -- "$p" | tar -x
done

# Whatever the harness built and ignores: vendored libraries, fixture binaries.
git -C "$CLONE" ls-files --others --ignored --exclude-standard -- test-infra \
  | grep -v -e '/node_modules/' -e '^test-infra/runner/' \
  | while read -r f; do mkdir -p "$(dirname "$f")"; cp -p "$CLONE/$f" "$f"; done

# The per-node configs a node of the ref's code reads, from the ref's production config.
mkdir -p config
cp test-infra/fixtures/userconfig-template.js config/userconfig.js
node test-infra/config/generate-configs.js
rm -f config/userconfig.js

./test-infra/build-images.sh fluxos-01
echo "build-release-image: flux-e2e-fluxos-01:$FLUX_E2E_TAG holds $REF ($(git -C "$CLONE" rev-parse --short "$REF^{commit}"))"
