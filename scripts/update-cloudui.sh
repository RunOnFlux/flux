#!/bin/bash

# Update CloudUI Script
# Downloads the latest dist.tar.gz from fluxos-frontend GitHub releases,
# verifies the SHA256 checksum, and updates the CloudUI folder.
#
# Usage: npm run update:cloudui
#        or: bash scripts/update-cloudui.sh
#
# Output:
# - CloudUI/ folder with the latest frontend build
# - CloudUI/version file containing the SHA256 hash of the installed version
#   (used by external projects to verify nodes have the latest version)
#
# Requirements:
# - curl
# - sha256sum or shasum (for checksum verification)
# - Standard tools: grep, sed, awk (no jq needed)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEMP_DIR=$(mktemp -d)
REPO="RunOnFlux/fluxos-frontend"
CLOUDUI_DIR="$PROJECT_ROOT/CloudUI"
RELEASE_API="https://api.github.com/repos/$REPO/releases/latest"

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

# Cleanup function
cleanup() {
    echo ""
    echo "Cleaning up temporary files..."
    rm -rf "$TEMP_DIR"
}

# Set trap to cleanup on exit
trap cleanup EXIT

echo "1. Fetching latest release information..."
RELEASE_JSON="$TEMP_DIR/release.json"
curl -s "$RELEASE_API" -o "$RELEASE_JSON"

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
curl -L -o "$TARBALL" "$DOWNLOAD_URL"

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
echo "5. Removing old CloudUI folder..."
rm -rf "$CLOUDUI_DIR"

echo ""
echo "6. Installing new CloudUI..."
mkdir -p "$CLOUDUI_DIR"
cp -r "$EXTRACT_DIR"/* "$CLOUDUI_DIR/"

echo ""
echo "7. Removing unnecessary files..."
rm -f "$CLOUDUI_DIR/stats.html" 2>/dev/null || true
rm -f "$CLOUDUI_DIR/_redirects" 2>/dev/null || true

echo ""
echo "8. Creating version file..."
echo "$EXPECTED_SHA256" > "$CLOUDUI_DIR/version"
echo "   Version file created with SHA256: $EXPECTED_SHA256"

echo ""
echo "=========================================="
echo "  CloudUI updated successfully!"
echo "=========================================="
echo ""
echo "Version: $TAG_NAME"
FOLDER_SIZE=$(du -sh "$CLOUDUI_DIR" | cut -f1)
echo "CloudUI folder size: $FOLDER_SIZE"
echo ""
echo "Files in CloudUI:"
ls -la "$CLOUDUI_DIR"
echo ""
echo "Don't forget to commit the changes!"
