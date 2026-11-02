#!/bin/sh
# Build and publish dist/ as the gh-pages branch of lasigeBioTM/XMR4EL (https://lasigebiotm.github.io/XMR4EL/).
# Force-push: gh-pages keeps one commit, so rebuilds don't grow the upstream history.
set -e
cd "$(dirname "$0")/.."
npm run build
rev=$(git rev-parse --short HEAD)
cd dist
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy xmr4el-web $rev"
git -c credential.helper= -c credential.helper='!gh auth git-credential' \
  push -f https://github.com/lasigeBioTM/XMR4EL.git gh-pages
rm -rf .git
