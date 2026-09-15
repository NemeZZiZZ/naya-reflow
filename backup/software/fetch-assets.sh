#!/bin/bash
# Download NayaFlow release assets from this repo's Releases.
# Usage: ./fetch-assets.sh v1.25.1 [destdir]
set -e
TAG="${1:?usage: fetch-assets.sh <tag> [destdir]}"
DEST="${2:-$TAG}"
mkdir -p "$DEST"
gh release download "$TAG" -R NemeZZiZZ/naya-reflow -D "$DEST"
ls -la "$DEST"
