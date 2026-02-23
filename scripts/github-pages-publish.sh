#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BRANCH="${GITHUB_PAGES_BRANCH:-gh-pages}"
MESSAGE="${GITHUB_PAGES_MESSAGE:-chore: publish github pages}"

if [[ ! -d "testApp/dist" ]]; then
  echo "[pages:publish] testApp/dist not found. Building first..."
  bash ./scripts/github-pages-build.sh
fi

touch testApp/dist/.nojekyll
cp testApp/dist/index.html testApp/dist/404.html

echo "[pages:publish] Publishing testApp/dist to branch '${BRANCH}'..."
echo "[pages:publish] This uses the 'gh-pages' npm package via npx."
npx --yes gh-pages -d testApp/dist -b "${BRANCH}" -m "${MESSAGE}"

echo "[pages:publish] Done."
