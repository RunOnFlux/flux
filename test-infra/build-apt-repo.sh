#!/bin/bash
# Turns the .debs apt has already downloaded into a signed apt repository.
#
# Run inside the image build, after `apt-get install --download-only` has
# populated the archive cache. What lands in the cache IS the dependency
# closure apt resolved against this image's exact package state, so the
# repository is complete by construction rather than by a maintained list -
# nothing here names a package or a version.
#
# Two distributions over one pool. FluxOS writes the syncthing source itself
# (systemService addSyncthingRepository) and its distribution and component are
# fixed at `syncthing`/`stable-v2`, so the repository has to answer to that
# name; the base packages have no such constraint and use `ubuntu`/`main`.
# Both index the same pool, so a package needed by either is present in both.
set -eu

REPO="${1:?usage: build-apt-repo.sh <repo-dir>}"
ARCH="$(dpkg --print-architecture)"

mkdir -p "$REPO/pool"
cp /var/cache/apt/archives/*.deb "$REPO/pool/"

# The signing key is generated here, not vendored. It signs nothing that exists
# outside this image, and a private key committed to git invites reuse somewhere
# it would matter. The public half ships in the repository as keyring.gpg.
export GNUPGHOME=/tmp/flux-apt-repo-gnupg
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"
gpg --batch --quiet --passphrase '' \
    --quick-generate-key 'Flux E2E Apt Repository' rsa3072 sign never

cd "$REPO"
for dist in ubuntu syncthing; do
  if [ "$dist" = 'syncthing' ]; then component='stable-v2'; else component='main'; fi
  target="dists/$dist/$component/binary-$ARCH"

  mkdir -p "$target"
  dpkg-scanpackages --arch "$ARCH" pool /dev/null > "$target/Packages"
  gzip -9cn "$target/Packages" > "$target/Packages.gz"

  apt-ftparchive \
    -o "APT::FTPArchive::Release::Origin=flux-e2e" \
    -o "APT::FTPArchive::Release::Suite=$dist" \
    -o "APT::FTPArchive::Release::Codename=$dist" \
    -o "APT::FTPArchive::Release::Components=$component" \
    -o "APT::FTPArchive::Release::Architectures=$ARCH" \
    release "dists/$dist" > "dists/$dist/Release"

  # InRelease (inline signature) rather than a detached Release.gpg: apt prefers
  # it, and it is one file to serve instead of two that can disagree.
  gpg --batch --yes --clearsign -o "dists/$dist/InRelease" "dists/$dist/Release"
done

gpg --batch --yes --export > "$REPO/keyring.gpg"
rm -rf "$GNUPGHOME"

# The installed syncthing version is whatever the upstream repository served at
# build time, so nothing downstream may hardcode it. Recorded here for the stub
# that answers the minimum-version check, which has to agree with the image or
# the check compares against a version no node has.
dpkg-deb -f "$(ls "$REPO"/pool/syncthing_*.deb | head -1)" Version > "$REPO/syncthing.version"
