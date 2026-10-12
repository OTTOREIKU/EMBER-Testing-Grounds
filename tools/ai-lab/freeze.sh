#!/bin/bash
# Freezes the working tree for a long measurement: freeze.sh <dest dir>. Copies the tracked app and data files as
# they stand on disk, every lab tool under app/tests (the `_*.mjs` that are not bundles), and links the repo's
# node_modules and assets into the copy (Windows: a junction, made with PowerShell; elsewhere: a symlink). A
# measurement then runs on the copy, so the repo can be edited while it runs.
# The copy is for playing and testing, not for building: the build's last step copies assets into dist, and on
# Windows that step meets the assets junction and fails (EPERM, it would have to make a symlink). Build in the repo.
# Deleting a frozen copy: remove the node_modules and assets LINKS first (Windows: `cmd /c rmdir <link>`), or a
# recursive delete may follow them into the repo's own.
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${1:?usage: freeze.sh <dest dir>}/TestingGrounds"
[ -e "$DEST" ] && { echo "$DEST exists already"; exit 1; }
mkdir -p "$DEST"
cd "$REPO" || exit 1
git ls-files -z app data | tar --null -T - -cf - | tar -x -C "$DEST"
for f in app/tests/_*.mjs; do case "$f" in *.bundle.mjs) ;; *) cp "$f" "$DEST/app/tests/" ;; esac; done
if command -v cygpath > /dev/null; then
  WIN_DEST="$(cygpath -w "$DEST")"
  WIN_REPO="$(cygpath -w "$REPO")"
  powershell.exe -NoProfile -Command "New-Item -ItemType Junction -Path '$WIN_DEST\\app\\node_modules' -Target '$WIN_REPO\\app\\node_modules' | Out-Null; New-Item -ItemType Junction -Path '$WIN_DEST\\assets' -Target '$WIN_REPO\\assets' | Out-Null"
else
  ln -s "$REPO/app/node_modules" "$DEST/app/node_modules"
  ln -s "$REPO/assets" "$DEST/assets"
fi
[ -d "$DEST/app/node_modules/esbuild" ] || { echo "no node_modules in the copy"; exit 1; }
echo "FROZEN $DEST"
