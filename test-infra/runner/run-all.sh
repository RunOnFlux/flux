#!/usr/bin/env bash
#
# Full integration run: every suite in tests/, sequentially, each in its own mocha
# process. Per-suite isolation matters because FluxOS suites leave open handles —
# the repo's `npm test` (mocha tests/**/*.js, one process) risks teardown bleed and
# hangs across suite boundaries. One process per suite keeps each run clean.
#
# Output is TAP (one `ok`/`not ok` line per test) plus ###-prefixed marker lines for
# suite boundaries, so a watcher can stream per-suite/per-test progress and a human
# can read per-suite pass/fail tallies. Per-suite TAP is also saved under /tmp/e2e-logs.
#
# Usage (from anywhere): test-infra/runner/run-all.sh
#   optional: SUITE_GLOB='tests/3*.js' test-infra/runner/run-all.sh  (subset)

set -uo pipefail

cd "$(dirname "$0")" || exit 99

LOG_DIR="${E2E_LOG_DIR:-/tmp/e2e-logs}"
SUITE_GLOB="${SUITE_GLOB:-tests/*.js}"
SUITE_TIMEOUT_MS="${SUITE_TIMEOUT_MS:-300000}"
mkdir -p "$LOG_DIR"

# A label unique to THIS invocation, stamped onto every docker object the run
# creates (see test-env.js runLabels()). The between-suite cleanup below scopes
# removal to it, so concurrent run-all invocations never delete each other's
# live fleets — the old `--filter name=e2e` cleanup matched all runs' containers.
RUN_LABEL="${E2E_RUN_LABEL:-run-$$-$(date +%s)}"
export E2E_RUN_LABEL="$RUN_LABEL"

# No ryuk under run-all: testcontainers-node REUSES one ryuk container across
# processes and every process ADOPTS its session id (reaper.ts getReaper →
# useExistingReaper), so all concurrent suites' containers share ONE session
# label. When ryuk's connection count touches zero for RYUK_RECONNECTION_TIMEOUT
# (two suites exiting back-to-back), it force-removes EVERYTHING wearing that
# label — including a sibling suite's live, mid-boot fleet — then exits.
# Observed killing suite 41's 12 just-booted containers in a full gate run.
# Cleanup is owned by the run-label scoping above + run-parallel.sh's gate-level
# sweep instead. Manual `npx mocha` runs (no run-all) keep ryuk: solo runs have
# no concurrency race and benefit from its crash safety.
export TESTCONTAINERS_RYUK_DISABLED=true

# Pick the /24 subnet base (three octets) all suites in this run will use. Each suite
# creates+tears down its own /24 network; a single run defaults to 198.18.0 (back
# compat), and parallel run-all.sh invocations auto-pick distinct free /24s so their
# fleets don't collide. The pool is the 512 /24s of 198.18.0.0/15 (the RFC 2544 range
# FluxOS accepts as public — see subnet-config.js). Override with TEST_SUBNET_BASE=a.b.c.
#
# A base is claimed by creating a lock directory (mkdir is atomic), so two run-all
# processes scanning at once can never grab the same /24 — closing the read-then-create
# race the old picker had (it read the in-use set, then created the network later, with
# a window where a sibling picked the same base). flock serialises the scan so a stale
# lock (dead owner) can be reclaimed without two processes racing the reclaim.
LOCK_ROOT="${E2E_BASE_LOCK_DIR:-/tmp/e2e-base-locks}"
mkdir -p "$LOCK_ROOT" 2>/dev/null
CLAIMED_BASE=""
_scan_and_claim() {            # sets CLAIMED_BASE ('' if the pool is exhausted)
  local used o2 o3 b owner
  used="$(docker network ls -q | xargs -r docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null)"
  for o2 in 18 19; do
    for o3 in $(seq 0 255); do
      b="198.$o2.$o3"
      case " $used " in *" $b.0/24 "*) continue;; esac   # a live network already owns it
      if [ -d "$LOCK_ROOT/$b" ]; then
        owner="$(cat "$LOCK_ROOT/$b/pid" 2>/dev/null)"
        if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then continue; fi  # claimed by a live run
        rm -rf "$LOCK_ROOT/$b"                            # stale claim from a dead run — reclaim
      fi
      if mkdir "$LOCK_ROOT/$b" 2>/dev/null; then
        echo "$$" > "$LOCK_ROOT/$b/pid"; CLAIMED_BASE="$b"; return 0
      fi
    done
  done
}
pick_free_base() {             # sets CLAIMED_BASE
  CLAIMED_BASE=""
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK_ROOT/.pick.lock"; flock 9; _scan_and_claim; flock -u 9
  else
    _scan_and_claim            # mkdir-claim is atomic on its own; reclaim race is moot single-host
  fi
}
release_base() { [ -n "${CLAIMED_BASE:-}" ] && rm -rf "${LOCK_ROOT:?}/$CLAIMED_BASE" 2>/dev/null; }
trap release_base EXIT INT TERM
if [ -z "${TEST_SUBNET_BASE:-}" ]; then
  pick_free_base
  export TEST_SUBNET_BASE="${CLAIMED_BASE:-198.18.0}"   # 198.18.0 fallback if pool exhausted
fi
echo "###SUBNET-BASE $TEST_SUBNET_BASE"

# shellcheck disable=SC2206
SUITES=( $(ls $SUITE_GLOB 2>/dev/null | sort) )
total=${#SUITES[@]}
i=0; pass_suites=0; fail_suites=0; fail_names=""

echo "###RUN-START total=$total $(date -u +%H:%M:%S)"
for f in "${SUITES[@]}"; do
  i=$((i + 1)); name=$(basename "$f" .js)

  # drop any orphaned objects THIS run leaked so a leak in one suite can't fail the
  # next — scoped to our own run label so a concurrent run-all's live fleet is untouched
  docker ps -aq --filter "label=flux-e2e-run=$RUN_LABEL" | xargs -r docker rm -f >/dev/null 2>&1
  docker network ls -q --filter "label=flux-e2e-run=$RUN_LABEL" | xargs -r docker network rm >/dev/null 2>&1
  docker volume ls -q --filter "label=flux-e2e-run=$RUN_LABEL" | xargs -r docker volume rm >/dev/null 2>&1

  echo "###SUITE-START [$i/$total] $name $(date -u +%H:%M:%S)"
  # Wall-clock backstop around mocha ITSELF: mocha deliberately runs without
  # --exit, so a suite that finishes its run but holds one leaked handle hangs
  # forever — and the gate driver waits on the pid, so one wedged suite stalls
  # the whole gate (suite 28 in the 2026-06-12 gate sat 65 minutes until killed
  # by hand). timeout must wrap mocha directly: bash defers traps while a
  # foreground child runs, so an outer timeout on this script could never fire.
  # node_modules/.bin/mocha (not npx) so the TERM lands on the mocha node
  # process, not a wrapper; -k escalates to KILL if the event loop is wedged.
  # A timed-out suite reports rc=124 (or 137 after the KILL) in SUITE-END.
  timeout -k 30s "${E2E_SUITE_WALL_SEC:-1800}s" node_modules/.bin/mocha "$f" --reporter tap --timeout "$SUITE_TIMEOUT_MS" 2>&1 | tee "$LOG_DIR/$name.tap"
  rc=${PIPESTATUS[0]}

  # grep -c prints the count (0 when none) but exits 1 on zero matches; `|| true`
  # keeps that single "0" without appending a second one (which would break the
  # numeric test below). Do NOT use `|| echo 0` here.
  passed=$(grep -c "^ok " "$LOG_DIR/$name.tap" 2>/dev/null || true)
  failed=$(grep -c "^not ok " "$LOG_DIR/$name.tap" 2>/dev/null || true)
  if [ "$rc" -eq 0 ] && [ "$failed" -eq 0 ]; then
    pass_suites=$((pass_suites + 1))
    echo "###SUITE-END [$i/$total] $name PASS ($passed passed) $(date -u +%H:%M:%S)"
  else
    fail_suites=$((fail_suites + 1)); fail_names="$fail_names $name"
    echo "###SUITE-END [$i/$total] $name FAIL ($passed passed, $failed failed, rc=$rc) $(date -u +%H:%M:%S)"
  fi
done

echo "###RUN-DONE suites_pass=$pass_suites suites_fail=$fail_suites failed:[$fail_names ] $(date -u +%H:%M:%S)"
[ "$fail_suites" -eq 0 ]
