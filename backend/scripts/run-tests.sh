#!/bin/sh
# node:test auto-discovers every file under test/ regardless of name
# (confirmed directly — even a file deliberately named to avoid the
# *.test.js convention still gets picked up), and by default runs
# different test FILES concurrently against this project's one shared
# local Postgres database.
#
# test/aiControl.test.js and test/aiControlRoutes.test.js are the two
# files that deliberately write real DISABLED/LOCKDOWN rows to the shared
# ai_control_state table (that's the actual thing they need to prove: the
# real DB-backed kill switch works, not a mock of it — see
# test/circuitBreaker.test.js's own header comment for the sibling file
# that mocks this exact boundary specifically to avoid this problem).
# While that state is live, any OTHER concurrently-running file's real
# aiService call sees it and fails for an unrelated reason — confirmed
# directly, repeatedly, as a real flake before this script existed. There's
# no way to prevent node:test from auto-discovering these files (see
# above), so instead this runs them alone, first (sequentially relative to
# each other too, for the same reason), isolated from every other file,
# then runs everything else together at normal concurrency. Slower by a
# second or two than one unified invocation, not by the ~5x a blanket
# --test-concurrency=1 for the whole suite would cost.
#
# Usage: scripts/run-tests.sh [extra node --test flags for the main run]
set -e

cd "$(dirname "$0")/.."

ISOLATED_FILES="test/aiControl.test.js test/aiControlRoutes.test.js test/aiKillSwitchProviderIsolation.test.js"

for f in $ISOLATED_FILES; do
  echo "--- Running $f in isolation (real DB kill-switch state) ---"
  NODE_ENV=test node --test --test-concurrency=1 "$f"
done

echo "--- Running the rest of the suite ---"
OTHER_TEST_FILES=$(find test -maxdepth 1 -name '*.test.js' ! -name 'aiControl.test.js' ! -name 'aiControlRoutes.test.js' ! -name 'aiKillSwitchProviderIsolation.test.js')
NODE_ENV=test node --test "$@" $OTHER_TEST_FILES
