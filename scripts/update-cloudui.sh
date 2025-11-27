#!/bin/bash

# Update CloudUI Script
# Fetches the latest fluxos-frontend from GitHub, builds it with SEO optimization,
# and updates the CloudUI folder in this project.
#
# Usage: npm run update:cloudui
#        or: bash scripts/update-cloudui.sh
#
# Requirements:
# - Node.js 18+
# - Git
# - For prerendering: Playwright with Chromium (installed automatically)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEMP_DIR=$(mktemp -d)
REPO_URL="https://github.com/RunOnFlux/fluxos-frontend.git"
BRANCH="master"
CLOUDUI_DIR="$PROJECT_ROOT/CloudUI"

echo "=========================================="
echo "  FluxOS CloudUI Update Script"
echo "=========================================="
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "Cleaning up temporary files..."
    rm -rf "$TEMP_DIR"
}

# Set trap to cleanup on exit
trap cleanup EXIT

echo "1. Cloning fluxos-frontend repository (branch: $BRANCH)..."
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TEMP_DIR/fluxos-frontend"
cd "$TEMP_DIR/fluxos-frontend"

echo ""
echo "2. Installing dependencies..."
npm install --legacy-peer-deps

echo ""
echo "3. Installing Playwright Chromium for prerendering..."
npx playwright install chromium

echo ""
echo "4. Building with SEO optimization (npm run build:seo)..."
npm run build:seo

echo ""
echo "5. Removing old CloudUI folder..."
rm -rf "$CLOUDUI_DIR"

echo ""
echo "6. Copying new build to CloudUI..."
mkdir -p "$CLOUDUI_DIR"
cp -r dist/* "$CLOUDUI_DIR/"

echo ""
echo "7. Removing unnecessary files..."
rm -f "$CLOUDUI_DIR/stats.html" 2>/dev/null || true
rm -f "$CLOUDUI_DIR/_redirects" 2>/dev/null || true

echo ""
echo "=========================================="
echo "  CloudUI updated successfully!"
echo "=========================================="
echo ""
echo "CloudUI folder size: $(du -sh "$CLOUDUI_DIR" | cut -f1)"
echo ""
echo "Files in CloudUI:"
ls -la "$CLOUDUI_DIR"
echo ""
echo "Don't forget to commit the changes!"
