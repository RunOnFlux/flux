#!/bin/bash
# Packages a pinned syncthing release as the `syncthing` deb the image's apt
# repository serves.
#
# syncthing's own repository carries only its two newest releases, so a version
# a suite depends on cannot be pinned there. The release on GitHub can: its
# checksums are signed by the release key vendored beside this script, and the
# tarball is checked against them before anything is packaged.
#
#   build-syncthing-deb.sh <version> <out-dir>
set -eu

VERSION="${1:?usage: build-syncthing-deb.sh <version> <out-dir>}"
OUT="${2:?usage: build-syncthing-deb.sh <version> <out-dir>}"
KEY="${SYNCTHING_RELEASE_KEY:-/tmp/syncthing-release-key.asc}"
# The key in that file: "Syncthing Release Management <release@syncthing.net>".
RELEASE_KEY_FINGERPRINT=FBA2E162F2F44657B38F0309E5665F9BD5970C47
ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64|arm64) ;;
  *) echo "build-syncthing-deb: syncthing publishes no linux release for $ARCH" >&2; exit 1 ;;
esac

BASE="https://github.com/syncthing/syncthing/releases/download/v${VERSION}"
TARBALL="syncthing-linux-${ARCH}-v${VERSION}.tar.gz"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL -o "$WORK/$TARBALL" "$BASE/$TARBALL"
curl -fsSL -o "$WORK/sha256sum.txt.asc" "$BASE/sha256sum.txt.asc"

export GNUPGHOME="$WORK/gnupg"
mkdir -m 700 "$GNUPGHOME"
gpg --batch --quiet --import "$KEY"
# The checksums carry more than one signature, and gpg fails on any it holds no
# key for. What counts is a valid signature by the release key and no bad one.
gpg --batch --status-file "$WORK/status" --output "$WORK/sha256sum.txt" --decrypt "$WORK/sha256sum.txt.asc" 2>/dev/null || true
if grep -q '^\[GNUPG:\] BADSIG ' "$WORK/status" || ! grep -q "^\[GNUPG:\] VALIDSIG ${RELEASE_KEY_FINGERPRINT} " "$WORK/status"; then
  echo "build-syncthing-deb: sha256sum.txt.asc for ${VERSION} is not signed by ${RELEASE_KEY_FINGERPRINT}" >&2
  exit 1
fi
(cd "$WORK" && grep -E "^[0-9a-f]{64}  ${TARBALL}\$" sha256sum.txt | sha256sum -c --status -)

tar -xzf "$WORK/$TARBALL" -C "$WORK"
PKG="$WORK/pkg"
mkdir -p "$PKG/DEBIAN" "$PKG/usr/bin"
install -m 0755 "$WORK/syncthing-linux-${ARCH}-v${VERSION}/syncthing" "$PKG/usr/bin/syncthing"
cat > "$PKG/DEBIAN/control" <<EOF
Package: syncthing
Version: ${VERSION}
Architecture: ${ARCH}
Maintainer: Flux E2E <e2e@flux.invalid>
Description: syncthing ${VERSION}, the release this image is pinned to
EOF
mkdir -p "$OUT"
dpkg-deb --build --root-owner-group "$PKG" "$OUT/syncthing_${VERSION}_${ARCH}.deb" >/dev/null
echo "build-syncthing-deb: syncthing ${VERSION} (${ARCH}) -> $OUT/syncthing_${VERSION}_${ARCH}.deb"
