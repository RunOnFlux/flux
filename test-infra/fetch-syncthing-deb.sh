#!/bin/bash
# Fetches the syncthing package a node installs, for a pinned release, from that
# release on GitHub: the same .deb syncthing's apt repository serves while the
# release is one of its two newest, built without self-upgrade. The file must
# match its line in syncthing-debs.sha256, beside this script in the image.
#
#   fetch-syncthing-deb.sh <version> <out-dir>
set -eu

VERSION="${1:?usage: fetch-syncthing-deb.sh <version> <out-dir>}"
OUT="${2:?usage: fetch-syncthing-deb.sh <version> <out-dir>}"
SUMS="${SYNCTHING_DEB_SUMS:-/tmp/syncthing-debs.sha256}"
DEB="syncthing_${VERSION}_$(dpkg --print-architecture).deb"

LINE="$(grep -E "^[0-9a-f]{64}  ${DEB}\$" "$SUMS" || true)"
if [ -z "$LINE" ]; then
  echo "fetch-syncthing-deb: no pinned sha256 for ${DEB} in $(basename "$SUMS")" >&2
  exit 1
fi
mkdir -p "$OUT"
curl -fsSL -o "$OUT/$DEB" "https://github.com/syncthing/syncthing/releases/download/v${VERSION}/${DEB}"
(cd "$OUT" && echo "$LINE" | sha256sum -c --status -) || {
  echo "fetch-syncthing-deb: ${DEB} does not match its pinned sha256" >&2
  rm -f "$OUT/$DEB"
  exit 1
}
echo "fetch-syncthing-deb: syncthing ${VERSION} -> $OUT/$DEB"
