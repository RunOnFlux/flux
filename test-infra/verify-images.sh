#!/usr/bin/env bash
# Refuses a run whose images do not match the tree.
#
# The failure this exists to stop is silent: an image built from an older tree
# runs this branch's suites and fails as though the product were broken. On
# 2026-08-11 a syncthing-stub image four commits behind cost a full 85-suite
# gate - suites 87, 88 and 90 died in a `before each` on an endpoint the image
# did not carry, which reads exactly like a restore defect.
#
# Every image carries `flux.e2e.src`, stamped by build-images.sh with the digest
# of its build context. Recompute that from the working tree and compare. An
# image with NO label fails too: images built before this check existed cannot
# be distinguished from correct ones, and treating unknown as fine is how the
# check would be defeated on the very boxes that need it.
#
#   usage: verify-images.sh          # every image, at $FLUX_E2E_TAG
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
TAG="${FLUX_E2E_TAG:-latest}"

# Derived, never listed - same rule as build-images.sh, so a lineage that adds a
# stub gets it checked without editing this file.
targets=(fluxos-01)
for dir in test-infra/*/; do
  [ -f "${dir}Dockerfile" ] && targets+=("$(basename "$dir")")
done

stale=()
for target in "${targets[@]}"; do
  image="flux-e2e-${target}:${TAG}"

  if ! want="$(test-infra/image-digest.sh "$target" 2>/dev/null)"; then
    stale+=("${image}|cannot compute a source digest for ${target}")
    continue
  fi

  if ! have="$(docker image inspect "$image" --format '{{index .Config.Labels "flux.e2e.src"}}' 2>/dev/null)"; then
    stale+=("${image}|not built under this tag")
    continue
  fi

  case "$have" in
    ''|'<no value>')
      stale+=("${image}|built before images were stamped - cannot be trusted")
      ;;
    "$want") ;;
    *)
      stale+=("${image}|source moved since it was built (image ${have:0:12}, tree ${want:0:12})")
      ;;
  esac
done

if [ "${#stale[@]}" -eq 0 ]; then
  echo "images verified against the tree (tag '${TAG}', ${#targets[@]} images)"
  exit 0
fi

echo "REFUSING TO RUN - ${#stale[@]} image(s) do not match this tree:" >&2
for entry in "${stale[@]}"; do
  printf '  %-42s %s\n' "${entry%%|*}" "${entry#*|}" >&2
done
echo >&2
echo "rebuild them, then run again:" >&2
echo "  FLUX_E2E_TAG=${TAG} ./test-infra/build-images.sh" >&2
exit 1
