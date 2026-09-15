#!/bin/zsh
cd /Users/nemezzizz/.config/openchamber/chats/2026-09-14/session-160103a9-9ed6-44d6-8da8-08a98d2cc39d/naya-archive
mkrel() {
  local tag="$1"; shift
  gh release create "$tag" --repo NemeZZiZZ/NayaFlow-releases --title "$tag" \
    --notes "Archival mirror of NayaTech/NayaFlow-releases@$tag (Naya is bankrupt; original may disappear)." "$@" >> upload.log 2>&1 \
    && echo "OK $tag" >> upload.log || echo "FAIL $tag" >> upload.log
}
mkrel v1.25.1 v1.25.1/*
for t in v0.1.1 v1.3.11 v1.6.10 v1.11.11 v1.15.1 v1.21.0; do
  mkrel "$t" "$t"/*.zip
done
echo DONE >> upload.log
