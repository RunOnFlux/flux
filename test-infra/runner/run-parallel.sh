#!/usr/bin/env bash
#
# Memory-gated PARALLEL integration runner.
#
# run-all.sh runs every suite sequentially (~2h for the full set). This runs the
# same suites concurrently, exploiting the per-run isolation that run-all.sh +
# test-env.js already provide: each invocation auto-claims a distinct /24 (atomic
# mkdir-claim under /tmp/e2e-base-locks), stamps a unique flux-e2e-run label on
# every container/network/volume, and scopes its own cleanup to that label. So N
# suites can run side by side without colliding on subnets, fleets, or cleanup —
# each suite even builds its OWN registry/stubs (test-env.js), so suite 33 stopping
# "its" registry never touches another suite's.
#
# The ONLY shared resource is the host (CPU/RAM/dockerd). Rather than a fixed N-way
# split (which idles slots when light suites finish early and risks OOM when heavy
# 10-node fleets overlap), this launches one single-suite run-all.sh per suite and
# admits a new one only when BOTH hold:
#   * fewer than MAXN suites are in flight, AND
#   * at least MIN_FREE_MB of memory is free.
# So it self-throttles to 2 when fleets are heavy and 3 when light, never OOMs
# (an OOM-killed node is indistinguishable from a real failure — see the suite-37
# investigation), and auto-refills as suites finish.
#
# Usage (from anywhere):
#   test-infra/runner/run-parallel.sh                 # all suites, heavy-first
#   SUITES='28 37 35' test-infra/runner/run-parallel.sh   # a chosen subset
#   MAXN=2 MIN_FREE_MB=20000 test-infra/runner/run-parallel.sh
#
# Per-suite TAP + run-all output land under $E2E_LOG_DIR (default /tmp/e2e-logs/<n>/);
# progress + the final tally stream to $E2E_LOG_DIR/driver.log; capture sidecars
# (docker events, host mem/load watch, dmesg OOM) sit beside them as cap-*.log.
# Exit status is non-zero if any suite failed.

set -o pipefail   # NOTE: deliberately NOT `set -u` — empty associative-array
                  # expansions (${#A[@]} on a declared-but-empty -A array) trip
                  # "unbound variable" under -u and would abort the admit loop.

cd "$(dirname "$0")" || exit 99
RUNNER="$PWD/run-all.sh"

# Same host-FluxOS guard as run-all.sh (which every suite also runs through) -
# checked here too so the gate fails in one second instead of launching 48
# suites that each abort individually. See run-all.sh for the full rationale.
if [ -z "${E2E_ALLOW_HOST_FLUXOS:-}" ]; then
  for unit in fluxos.service flux-watchdog.timer flux-watchdog.service; do
    if systemctl is-active --quiet "$unit" 2>/dev/null; then
      echo "###ABORT host FluxOS is running ($unit is active) - it stops/adopts harness containers."
      echo "Stop it for the run:  sudo systemctl stop flux-watchdog.timer flux-watchdog.service fluxos.service"
      echo "Or set E2E_ALLOW_HOST_FLUXOS=1 to run anyway."
      exit 97
    fi
  done
fi

LOGROOT="${E2E_LOG_DIR:-/tmp/e2e-logs}"
MAXN="${MAXN:-3}"
MIN_FREE_MB="${MIN_FREE_MB:-15000}"
# Don't admit a new suite while the box is already CPU-saturated. Memory never
# binds on a big host (lesson from the first full gate: 3 fleets used ~3GB of
# 61GB) — CPU does, and a fleet admitted onto a hot box boots so slowly it can
# blow event-wait budgets while perfectly healthy. This is a launch-time backstop
# only; the boot semaphore in test-env.js is what serialises the contended phase
# itself (suites boot fleets mid-run too, which no admit gate can see).
MAX_LOAD="${MAX_LOAD:-$(( $(nproc) * 3 / 4 ))}"

# Default order: heavy reconciler/fleet suites first so the long pole starts ASAP;
# everything else after. Derived from tests/ so new suites are picked up; override
# with SUITES='..' (space-separated numeric prefixes).
if [ -z "${SUITES:-}" ]; then
  all=$(ls tests/*.js 2>/dev/null | sed -E 's#.*/([0-9]+)-.*#\1#' | sort -u)
  heavy=""; light=""
  for n in $all; do
    if [ "$((10#$n))" -ge 28 ]; then heavy="$heavy $n"; else light="$light $n"; fi
  done
  SUITES="$heavy $light"
fi

free_mb(){ free -m | awk '/^Mem:/{print $7}'; }
load_1m(){ cut -d' ' -f1 /proc/loadavg | cut -d. -f1; }   # integer part is enough for a gate

# Gate-level sweep of harness-owned docker objects. run-all.sh disables ryuk
# (see the comment there), so a crashed suite's leftovers are no longer reaped
# automatically — and per-run labels are unique, so later runs' label-scoped
# cleanup can't match them. Sweep before the gate (a dirty box makes every
# suite instant-fail on subnet collisions) and after it (leave the box clean).
# Scoped to harness names/labels only — never a blanket prune; assumes one gate
# per box, which run-parallel has always required.
sweep_harness_leftovers(){
  # scope to OUR label (key presence, any run id) - org.testcontainers=true would
  # also kill unrelated testcontainers projects sharing the box
  docker ps -aq --filter label=flux-e2e-run | xargs -r docker rm -f >/dev/null 2>&1
  docker network ls --format '{{.ID}} {{.Name}}' | grep ' flux-test-' | awk '{print $1}' | xargs -r docker network rm >/dev/null 2>&1
  docker volume ls -q --filter label=flux-e2e-run | xargs -r docker volume rm >/dev/null 2>&1
  rm -rf /tmp/e2e-base-locks /tmp/e2e-boot-lock
}

rm -rf "$LOGROOT"; mkdir -p "$LOGROOT"
DLOG="$LOGROOT/driver.log"
log(){ echo "$(date -u +%H:%M:%S) $*" | tee -a "$DLOG"; }

sweep_harness_leftovers

# ---- capture sidecars (best-effort; killed on exit) ----
( sudo dmesg -wT 2>/dev/null | grep --line-buffered -iE 'oom|killed process' ) > "$LOGROOT/cap-dmesg.log" 2>&1 & CAP1=$!
( while true; do echo "$(date -u +%H:%M:%S) avail=$(free_mb)MB load=$(cut -d' ' -f1 /proc/loadavg) containers=$(docker ps -q 2>/dev/null | wc -l)"; sleep 5; done ) > "$LOGROOT/cap-mem.log" 2>&1 & CAP2=$!
( docker events --filter event=die --filter event=kill --filter event=oom \
    --format '{{.Time}} {{.Action}} name={{.Actor.Attributes.name}} exitCode={{.Actor.Attributes.exitCode}}' ) > "$LOGROOT/cap-events.log" 2>&1 & CAP3=$!
trap 'kill $CAP1 $CAP2 $CAP3 2>/dev/null' EXIT

declare -A PID2SUITE

launch(){
  local s=$1
  SUITE_GLOB="tests/${s}-*.js" E2E_RUN_LABEL="par-${s}-$$" E2E_LOG_DIR="$LOGROOT/$s" \
    bash "$RUNNER" > "$LOGROOT/$s.out" 2>&1 &
  PID2SUITE[$!]=$s
  log "LAUNCH  suite $s pid=$! inflight=${#PID2SUITE[@]} avail=$(free_mb)MB"
}

reap(){
  local pid s rc res
  for pid in "${!PID2SUITE[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"; rc=$?
      s=${PID2SUITE[$pid]}
      res=$(grep -aoE '###RUN-DONE.*' "$LOGROOT/$s.out" 2>/dev/null | tail -1)
      log "DONE    suite $s rc=$rc :: ${res:-<no RUN-DONE marker>}"
      unset 'PID2SUITE[$pid]'
    fi
  done
}

log "START   MAXN=$MAXN MIN_FREE_MB=$MIN_FREE_MB MAX_LOAD=$MAX_LOAD suites=$(echo $SUITES | wc -w) head=$(git -C "$PWD" rev-parse --short HEAD 2>/dev/null)"
for s in $SUITES; do
  while :; do
    reap
    if [ "${#PID2SUITE[@]}" -lt "$MAXN" ] && [ "$(free_mb)" -gt "$MIN_FREE_MB" ] && [ "$(load_1m)" -lt "$MAX_LOAD" ]; then break; fi
    sleep 3
  done
  launch "$s"
  sleep 2   # small stagger so two fleets don't boot in lockstep
done
while [ "${#PID2SUITE[@]}" -gt 0 ]; do reap; sleep 3; done

# ---- aggregate ----
log "===== AGGREGATE ====="
pass=0; fail=0; failed=""
for s in $SUITES; do
  rd=$(grep -aoE '###RUN-DONE suites_pass=[0-9]+ suites_fail=[0-9]+' "$LOGROOT/$s.out" 2>/dev/null | tail -1)
  sp=$(printf '%s' "$rd" | sed -nE 's/.*suites_pass=([0-9]+).*/\1/p')
  sf=$(printf '%s' "$rd" | sed -nE 's/.*suites_fail=([0-9]+).*/\1/p')
  # a slot passes when its run-all reported >=1 suite and zero failures. Never
  # match 'suites_pass=1' literally: a slot's glob can run SEVERAL suite files
  # (28 and 32 run two each), which a literal match miscounts as a failure.
  if [ "${sp:-0}" -ge 1 ] && [ "${sf:-1}" -eq 0 ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1)); failed="$failed $s"
  fi
done
sweep_harness_leftovers

log "RESULT  suites_pass=$pass suites_fail=$fail FAILED:[$failed ]"
log "###PAR-DONE"
[ "$fail" -eq 0 ]
