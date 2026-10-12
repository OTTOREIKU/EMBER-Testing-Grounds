#!/bin/bash
# THE GUARDS: eight hashes of seeded games played start to end by the computer's seats (tests/_samegames.mjs and
# _samesmoke.mjs), so a change that should not move play can be shown not to, and one that should, by how much.
# A change that leaves the AI alone must print the same eight; the current set is in the AI plan and the work log.
#   bash tools/ai-lab/guards.sh          APP_DIR=<another app copy>   GT / GTF: the Tactician specs played
cd "${APP_DIR:-$(dirname "$0")/../../app}" || exit 1
NODE="${NODE:-node}"
T="${GT:-tactician}"; TF="${GTF:-tactician:-focus}"
echo "== HIDE=${HIDE:-} HIDETAG=${HIDETAG:-} in $(pwd)"
"$NODE" tests/_samegames.mjs "$TF" brawler 2 | tail -n 1
"$NODE" tests/_samegames.mjs brawler eager 3 | tail -n 1
"$NODE" tests/_samegames.mjs legal legal 4 | tail -n 1
"$NODE" tests/_samesmoke.mjs "$T" "$T" 2 | tail -n 1
"$NODE" tests/_samesmoke.mjs "$T" brawler 2 | tail -n 1
"$NODE" tests/_samesmoke.mjs brawler eager 3 | tail -n 1
"$NODE" tests/_samesmoke.mjs legal legal 6 | tail -n 1
"$NODE" tests/_samesmoke.mjs eager legal 4 | tail -n 1
echo "== done"
