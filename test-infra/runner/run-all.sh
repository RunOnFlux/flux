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

# Pick the /24 subnet base (three octets) all suites in this run will use. Each suite
# creates+tears down its own /24 network; a single run defaults to 198.18.0 (back
# compat), and parallel run-all.sh invocations auto-pick distinct free /24s so their
# fleets don't collide. The pool is the 512 /24s of 198.18.0.0/15 (the RFC 2544 range
# FluxOS accepts as public — see subnet-config.js). Override with TEST_SUBNET_BASE=a.b.c.
pick_free_base() {
  local used o2 o3 b
  used="$(docker network ls -q | xargs -r docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null)"
  for o2 in 18 19; do
    for o3 in $(seq 0 255); do
      b="198.$o2.$o3"
      case " $used " in
        *" $b.0/24 "*) ;;     # already in use
        *) echo "$b"; return 0;;
      esac
    done
  done
  echo "198.18.0"             # pool exhausted; fall back (createNetwork will error on collision)
}
if [ -z "${TEST_SUBNET_BASE:-}" ]; then
  export TEST_SUBNET_BASE="$(pick_free_base)"
fi
echo "###SUBNET-BASE $TEST_SUBNET_BASE"

# shellcheck disable=SC2206
SUITES=( $(ls $SUITE_GLOB 2>/dev/null | sort) )
total=${#SUITES[@]}
i=0; pass_suites=0; fail_suites=0; fail_names=""

echo "###RUN-START total=$total $(date -u +%H:%M:%S)"
for f in "${SUITES[@]}"; do
  i=$((i + 1)); name=$(basename "$f" .js)

  # drop any orphaned e2e containers/networks so a leak in one suite can't fail the next
  docker ps -aq --filter name=e2e | xargs -r docker rm -f >/dev/null 2>&1
  docker network ls --filter name=e2e -q | xargs -r docker network rm >/dev/null 2>&1

  echo "###SUITE-START [$i/$total] $name $(date -u +%H:%M:%S)"
  npx mocha "$f" --reporter tap --timeout "$SUITE_TIMEOUT_MS" 2>&1 | tee "$LOG_DIR/$name.tap"
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
