#!/bin/bash
# THE PROOF OF A CHANGE, in one go: the suite (runall.mjs), the type check, the guards (guards.sh), and the three
# snapshots of the Match Centre's own output (the HUD, the Movement and the launch prints) against a baseline taken
# before the change, then the build. A change that should not move what the pages print must differ 0 in all three.
#   bash tools/ai-lab/verify.sh <out dir> [<baseline dir>]
# The baselines are large (tens of MB) and kept out of the repo: print them first from the commit to compare with,
#   node tests/_hudprint.mjs <dir>/hud.json; node tests/_moveprint.mjs <dir>/move.json; node tests/_launchprint.mjs <dir>/launch.json
# (run from app/, on that commit), and pass that folder as the baseline.
LAB="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?usage: verify.sh <out dir> [<baseline dir>]}"
BASE="$2"
NODE="${NODE:-node}"
mkdir -p "$OUT"
APP="${APP_DIR:-$LAB/../../app}"
RUNALL_OUT="$OUT/runall.out.txt" PAR="${PAR:-8}" "$NODE" "$LAB/runall.mjs" > "$OUT/suite.out" 2>&1 &
bash "$LAB/guards.sh" > "$OUT/guards.out" 2>&1
cd "$APP" || exit 1
{
  echo "== head $(git rev-parse --short HEAD), $(git status --short | wc -l) changed files"
  echo "== tsc"
  "$NODE" node_modules/typescript/bin/tsc --noEmit -p . ; echo "tsc exit $?"
  for k in hud move launch; do
    echo "== $k"
    "$NODE" "tests/_${k}print.mjs" "$OUT/$k.json" 2>&1 | tail -1
    [ -n "$BASE" ] && "$NODE" "$LAB/printdiff.mjs" "$BASE/$k.json" "$OUT/$k.json" 2>&1 | head -1
  done
} > "$OUT/snaps.out" 2>&1
wait
tail -3 "$OUT/suite.out" >> "$OUT/snaps.out"
{
  echo "== build"
  "$NODE" node_modules/vite/bin/vite.js build 2>&1 | tail -2
  echo "build exit ${PIPESTATUS[0]}"
} >> "$OUT/snaps.out" 2>&1
cat "$OUT/guards.out" "$OUT/snaps.out"
grep "^FAIL" "$OUT/suite.out"
