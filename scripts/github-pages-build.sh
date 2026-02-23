#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

detect_repo_name() {
  local remote_url
  remote_url="$(git config --get remote.origin.url 2>/dev/null || true)"
  if [[ -z "$remote_url" ]]; then
    echo "simple-pdf-parser"
    return
  fi

  remote_url="${remote_url%.git}"
  remote_url="${remote_url##*:}"
  remote_url="${remote_url##*/}"
  echo "$remote_url"
}

REPO_NAME="${GITHUB_PAGES_REPO_NAME:-$(detect_repo_name)}"
BASE_PATH="${GITHUB_PAGES_BASE:-/${REPO_NAME}/}"

if [[ "$BASE_PATH" != /* ]]; then
  BASE_PATH="/${BASE_PATH}"
fi
if [[ "$BASE_PATH" != */ ]]; then
  BASE_PATH="${BASE_PATH}/"
fi

echo "[pages:build] Using base path: ${BASE_PATH}"
echo "[pages:build] Installing root dependencies..."
npm install
echo "[pages:build] Installing testApp dependencies..."
npm --prefix testApp install
echo "[pages:build] Building library..."
npm run build:lib
echo "[pages:build] Building test app bundle for GitHub Pages..."
npm --prefix testApp run build -- --base "${BASE_PATH}"

touch testApp/dist/.nojekyll
cp testApp/dist/index.html testApp/dist/404.html

echo "[pages:build] Output ready in testApp/dist"
echo "[pages:build] Upload/publish this directory to GitHub Pages (gh-pages branch)."
