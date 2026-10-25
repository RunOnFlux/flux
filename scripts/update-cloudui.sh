#!/bin/bash

# Update CloudUI Script
# Downloads the latest dist.tar.gz from fluxos-frontend GitHub releases,
# verifies the SHA256 checksum, and updates the CloudUI folder.
#
# The API base URL is required - see the note on API_BASE_URL below for why it is
# an argument rather than a default or an environment variable.
#
# Usage: npm run update:cloudui -- <api-base-url>
#        or: bash scripts/update-cloudui.sh <api-base-url>
#
# Output:
# - CloudUI, a symlink to the installed build in .cloudui/
# - CloudUI/version file containing the SHA256 hash of the installed version
#   (used by external projects to verify nodes have the latest version)
# - CloudUI/tag file containing the release tag of the installed version
#
# Installing never leaves CloudUI missing or partly written: each build is unpacked into
# its own folder under .cloudui/, and CloudUI is switched to it by renaming a new symlink
# over the old one, which is atomic. A CloudUI that is still a real folder is swapped for
# the symlink with `mv --exchange` where mv has it; where it does not, the folder is moved
# aside and the symlink renamed into its place, so CloudUI is absent between those two
# renames, once.
#
# Everything a run creates lives in .cloudui/, and every run removes all of it except the
# installed build when it exits. A run that is killed outright leaves its files for the
# next run to remove.
#
# Requirements:
# - curl
# - sha256sum or shasum (for checksum verification)
# - GNU coreutils (mv -T) and flock (Linux)
# - Standard tools: grep, sed, awk (no jq needed)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
REPO="RunOnFlux/fluxos-frontend"
CLOUDUI_DIR="$PROJECT_ROOT/CloudUI"
STORE_NAME=".cloudui"
STORE_DIR="$PROJECT_ROOT/$STORE_NAME"

# The API host is supplied by the caller, which reads it from ZelBack's config. It is
# deliberately NOT defaulted and NOT read from the environment: config is the single source
# of truth for every endpoint a node reaches, and an environment variable would hand that
# choice back to whoever starts the process. A caller that forgets the argument gets a
# failure, never a silent fetch from the public internet.
API_BASE_URL="${1:-}"
if [ -z "$API_BASE_URL" ]; then
    echo "Error: no API base URL given."
    echo "Usage: $0 <api-base-url>    (e.g. https://api.github.com)"
    exit 1
fi
RELEASE_API="$API_BASE_URL/repos/$REPO/releases/latest"

echo "=========================================="
echo "  FluxOS CloudUI Update Script"
echo "=========================================="
echo ""

# Check for required commands
if ! command -v curl &> /dev/null; then
    echo "Error: curl is required but not installed."
    exit 1
fi

# Determine which sha256 command is available
if command -v sha256sum &> /dev/null; then
    SHA256_CMD="sha256sum"
elif command -v shasum &> /dev/null; then
    SHA256_CMD="shasum -a 256"
else
    echo "Error: sha256sum or shasum is required but not installed."
    exit 1
fi

if ! command -v flock &> /dev/null; then
    echo "Error: flock is required but not installed."
    exit 1
fi

# Removes everything in .cloudui/ except the lock and the build CloudUI points to.
remove_unused_builds() {
    local installed=""
    if [ -L "$CLOUDUI_DIR" ]; then
        installed="$PROJECT_ROOT/$(readlink "$CLOUDUI_DIR")"
    fi
    local entry
    for entry in "$STORE_DIR"/*; do
        if [ ! -e "$entry" ] && [ ! -L "$entry" ]; then
            continue
        fi
        if [ "$entry" != "$installed" ]; then
            rm -rf "$entry"
        fi
    done
}

cleanup() {
    echo ""
    echo "Cleaning up temporary files..."
    remove_unused_builds
}

# One run at a time: a run removes every build but the installed one, which includes any
# build another run is still unpacking.
mkdir -p "$STORE_DIR"
exec 9>"$STORE_DIR/.lock"
flock 9

trap cleanup EXIT

TEMP_DIR=$(mktemp -d "$STORE_DIR/work.XXXXXX")
RUN_ID="${TEMP_DIR##*.}"

# Each curl closes the lock descriptor, so a download that outlives a killed run does not
# hold the lock against the next one.
echo "1. Fetching latest release information..."
RELEASE_JSON="$TEMP_DIR/release.json"
curl -s "$RELEASE_API" -o "$RELEASE_JSON" 9>&-

# Check if we got a valid response
if ! grep -q '"tag_name"' "$RELEASE_JSON"; then
    echo "Error: Failed to fetch release information from GitHub."
    cat "$RELEASE_JSON"
    exit 1
fi

# Parse JSON using grep/sed (no jq needed)
TAG_NAME=$(grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' "$RELEASE_JSON" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
PUBLISHED_AT=$(grep -o '"published_at"[[:space:]]*:[[:space:]]*"[^"]*"' "$RELEASE_JSON" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')

echo "   Latest release: $TAG_NAME"
echo "   Published: $PUBLISHED_AT"

# Find the line where "name": "dist.tar.gz" appears
ASSET_LINE=$(grep -n '"name"[[:space:]]*:[[:space:]]*"dist.tar.gz"' "$RELEASE_JSON" | head -1 | cut -d: -f1)

if [ -z "$ASSET_LINE" ]; then
    echo "Error: dist.tar.gz not found in release assets."
    exit 1
fi

# Extract the asset block (from dist.tar.gz line to end of that asset object - about 35 lines after)
ASSET_END=$((ASSET_LINE + 35))
ASSET_BLOCK=$(sed -n "${ASSET_LINE},${ASSET_END}p" "$RELEASE_JSON")

# Get the download URL (appears after the name field)
DOWNLOAD_URL=$(echo "$ASSET_BLOCK" | grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')

# Get the digest (sha256:hash format)
EXPECTED_DIGEST=$(echo "$ASSET_BLOCK" | grep -o '"digest"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')

# Get file size
ASSET_SIZE=$(echo "$ASSET_BLOCK" | grep -o '"size"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed 's/.*: *//')

if [ -z "$DOWNLOAD_URL" ]; then
    echo "Error: Could not extract download URL from release."
    exit 1
fi

if [ -z "$EXPECTED_DIGEST" ]; then
    echo "Error: Could not extract checksum digest from release."
    exit 1
fi

# Extract SHA256 hash from digest (format: "sha256:hash")
EXPECTED_SHA256=$(echo "$EXPECTED_DIGEST" | sed 's/sha256://')

echo ""
echo "2. Downloading dist.tar.gz..."
echo "   URL: $DOWNLOAD_URL"
if [ -n "$ASSET_SIZE" ]; then
    SIZE_MB=$(awk "BEGIN {printf \"%.2f\", $ASSET_SIZE / 1024 / 1024}")
    echo "   Size: $SIZE_MB MB"
fi
echo "   Expected SHA256: $EXPECTED_SHA256"

TARBALL="$TEMP_DIR/dist.tar.gz"
curl -L -o "$TARBALL" "$DOWNLOAD_URL" 9>&-

echo ""
echo "3. Verifying SHA256 checksum..."
ACTUAL_SHA256=$($SHA256_CMD "$TARBALL" | awk '{print $1}')

echo "   Calculated SHA256: $ACTUAL_SHA256"

if [ "$EXPECTED_SHA256" != "$ACTUAL_SHA256" ]; then
    echo ""
    echo "ERROR: Checksum verification FAILED!"
    echo "   Expected: $EXPECTED_SHA256"
    echo "   Got:      $ACTUAL_SHA256"
    echo ""
    echo "The downloaded file may be corrupted or tampered with."
    exit 1
fi

echo "   Checksum verified successfully!"

echo ""
echo "4. Extracting archive..."
mkdir -p "$TEMP_DIR/extracted"
tar -xzf "$TARBALL" -C "$TEMP_DIR/extracted"

# Check if files are in a subdirectory or directly in extracted folder
if [ -d "$TEMP_DIR/extracted/dist" ]; then
    EXTRACT_DIR="$TEMP_DIR/extracted/dist"
else
    EXTRACT_DIR="$TEMP_DIR/extracted"
fi

echo "   Extracted to: $EXTRACT_DIR"
FILE_COUNT=$(ls "$EXTRACT_DIR" | wc -l)
echo "   Files: $FILE_COUNT"

echo ""
echo "5. Removing unnecessary files..."
rm -f "$EXTRACT_DIR/stats.html" 2>/dev/null || true
rm -f "$EXTRACT_DIR/_redirects" 2>/dev/null || true

echo ""
echo "6. Creating version and tag files..."
echo "$EXPECTED_SHA256" > "$EXTRACT_DIR/version"
echo "$TAG_NAME" > "$EXTRACT_DIR/tag"
echo "   Version file created with SHA256: $EXPECTED_SHA256"
echo "   Tag file created with tag: $TAG_NAME"

echo ""
echo "7. Installing new CloudUI..."
BUILD_NAME="build.$RUN_ID"
mv -T "$EXTRACT_DIR" "$STORE_DIR/$BUILD_NAME"
NEW_LINK="$STORE_DIR/link.$RUN_ID"
ln -s "$STORE_NAME/$BUILD_NAME" "$NEW_LINK"
if [ -L "$CLOUDUI_DIR" ] || [ ! -e "$CLOUDUI_DIR" ]; then
    mv -T "$NEW_LINK" "$CLOUDUI_DIR"
    echo "   Linked CloudUI to the new build"
elif mv -T --exchange "$NEW_LINK" "$CLOUDUI_DIR" 2>/dev/null; then
    echo "   Swapped the CloudUI folder for a link to the new build"
else
    mv -T "$CLOUDUI_DIR" "$STORE_DIR/previous.$RUN_ID"
    mv -T "$NEW_LINK" "$CLOUDUI_DIR"
    echo "   Moved the CloudUI folder aside and linked the new build in its place"
fi
echo "   CloudUI -> $STORE_NAME/$BUILD_NAME"

echo ""
echo "=========================================="
echo "  CloudUI updated successfully!"
echo "=========================================="
echo ""
echo "Version: $TAG_NAME"

