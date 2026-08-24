#!/usr/bin/env bash
# Build every image the harness runs, under one tag.
#
# One box hosts more than one branch's harness work at a time and the image
# names are fixed, so an untagged rebuild silently replaces whatever another
# branch built - and a run then mixes this branch's tree with that branch's
# images, which fails in ways that look like product bugs. Tag per branch and
# both can sit side by side:
#
#   FLUX_E2E_TAG=placement ./test-infra/build-images.sh
#   FLUX_E2E_TAG=placement npx mocha "tests/76-*.js" --timeout 400000
#
# The default tag is `latest`, which is what an untagged `docker build`
# produces, so single-branch use is unchanged.
#
# Pass image names to build a subset:
#   FLUX_E2E_TAG=placement ./test-infra/build-images.sh fluxos-01 external-http-stub
set -euo pipefail

TAG="${FLUX_E2E_TAG:-latest}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# The stub set is DERIVED, never listed: it differs by lineage (v9 carries a
# fluxdrive-stub the development lineage neither builds nor references), and a
# hardcoded list silently skips whichever image the other lineage added.
mapfile -t STUBS < <(
  for dir in test-infra/*/; do
    [ -f "${dir}Dockerfile" ] && basename "$dir"
  done
)

build_fluxos() {
  # The app binary the fixtures need; gitignored, so it survives branch switches
  # and is easy to forget after a clean. Not guarded on the script existing: it
  # is present on every lineage, and a guard there would let this produce a
  # complete image set with no binary in it - which surfaces as eight suites
  # failing twenty minutes later, looking like product bugs.
  echo "==> test-app binary"
  bash test-infra/test-app/build.sh
  echo "==> flux-e2e-fluxos-01:${TAG}"
  docker build -f test-infra/Dockerfile.fluxos -t "flux-e2e-fluxos-01:${TAG}" .
}

build_stub() {
  echo "==> flux-e2e-$1:${TAG}"
  docker build -t "flux-e2e-$1:${TAG}" "test-infra/$1"
}

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  targets=(fluxos-01 "${STUBS[@]}")
fi

for target in "${targets[@]}"; do
  if [ "$target" = "fluxos-01" ]; then
    build_fluxos
  else
    build_stub "$target"
  fi
done

echo
echo "built under tag '${TAG}':"
docker images --format '  {{.Repository}}:{{.Tag}}  {{.CreatedSince}}' \
  | grep -E "flux-e2e-.*:${TAG}\b" || true
echo
echo "run with:  FLUX_E2E_TAG=${TAG} npx mocha \"tests/NN-*.js\" --timeout 400000"
