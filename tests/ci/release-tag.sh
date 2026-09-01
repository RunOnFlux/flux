#!/usr/bin/env bash
#
# Tests for .github/workflows/release-tag.yml.
#
# Covers the "Tag already cut?" step, which decides whether a release that has just landed on
# master still needs verifying and tagging. Getting that decision wrong in the permissive
# direction is silent: the job skips the merged-tree verification -- the only check covering what
# master actually holds -- cuts no tag, and reports green.
#
# The step under test is EXTRACTED VERBATIM from the workflow, never retyped, so what runs here is
# what ships. It carries no ${{ }} (the version arrives through env:), so it runs as a plain
# script against a local bare repository standing in for origin.
#
# Two kinds of check:
#   * behaviour  -- the step's own decisions, eight cases
#   * contract   -- that the rest of the job still reads the output the way the step writes it,
#                   which is where a plausible-looking change does its damage
#
# Then every check is mutation-tested: five defects are reintroduced one at a time and the suite
# must go red for each. A suite that stays green under a mutation is not testing what it claims.
#
# Verified separately against real GitHub on 2026-09-01, because a local bare repo cannot prove it:
# annotated tags advertise a peeled refs/tags/<name>^{} entry over https and the pattern form
# matches it (github.com/git/git, tag v2.39.2); lightweight tags advertise no such entry. At that
# date RunOnFlux/flux held 312 tags and not one was annotated -- which is why reading only the
# peeled form finds none of the tags cut by hand.
#
# No network, no secrets. Everything lives under a mktemp -d removed on exit.
#
# Usage: tests/ci/release-tag.sh [path-to-repo]

set -uo pipefail

REPO=${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
WORKFLOW="$REPO/.github/workflows/release-tag.yml"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
FAILED_CASES=()

# ---------------------------------------------------------------- extract the step, verbatim
extract_step() {
  python3 - "$WORKFLOW" "$1" <<'PY'
import sys, yaml
doc = yaml.safe_load(open(sys.argv[1]))
steps = [s for s in doc['jobs']['tag']['steps'] if s.get('name') == 'Tag already cut?']
assert len(steps) == 1, f"expected one 'Tag already cut?' step, found {len(steps)}"
run = steps[0]['run']
assert '${{' not in run, "the step interpolates ${{ }} into the shell -- it cannot be run verbatim"
open(sys.argv[2], 'w').write(run)
PY
}

# ---------------------------------------------------------------- the world the step runs against
# A bare repo as origin, holding two commits, plus a clone whose origin points at it.
build_world() {
  rm -rf "$WORK/origin.git" "$WORK/clone"
  mkdir -p "$WORK/src"
  (
    cd "$WORK/src" && rm -rf .git ./*
    git init -q . && git config user.email t@t && git config user.name t
    echo one > f && git add f && git commit -qm one
    echo two > f && git add f && git commit -qm two
  )
  git clone -q --bare "$WORK/src" "$WORK/origin.git"
  git clone -q "$WORK/origin.git" "$WORK/clone"
  HEAD_SHA=$(git -C "$WORK/clone" rev-parse HEAD)
  OTHER_SHA=$(git -C "$WORK/clone" rev-parse 'HEAD^')
}

tag_on_origin() { # <name> <sha> <annotated|lightweight>
  local name=$1 sha=$2 kind=$3
  if [ "$kind" = annotated ]; then
    git -C "$WORK/src" tag -a "$name" -m "annotated $name" "$sha" -f
  else
    git -C "$WORK/src" tag "$name" "$sha" -f
  fi
  git -C "$WORK/src" push -q --force "$WORK/origin.git" "refs/tags/$name"
}

# ---------------------------------------------------------------- reporting
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); FAILED_CASES+=("$1"); printf '  FAIL %s\n' "$1"; shift; printf '         %s\n' "$@"; }

# ---------------------------------------------------------------- one behaviour case
# run_case <label> <step.sh> <version> <github_sha> <expect_exit> <expect_done|unset> [expect_text]
run_case() {
  local label=$1 step=$2 version=$3 sha=$4 want_exit=$5 want_done=$6 want_text=${7:-}
  local out rc got_done gho="$WORK/gh_output"
  : > "$gho"

  out=$(cd "$WORK/clone" && VERSION="$version" GITHUB_SHA="$sha" GITHUB_OUTPUT="$gho" \
        bash "$step" 2>&1)
  rc=$?

  if grep -q '^done=' "$gho"; then
    got_done=$(grep '^done=' "$gho" | tail -1 | cut -d= -f2)
  else
    got_done=unset
  fi

  local problems=()
  [ "$rc" = "$want_exit" ]       || problems+=("exit $rc, wanted $want_exit")
  [ "$got_done" = "$want_done" ] || problems+=("done=$got_done, wanted done=$want_done")
  if [ -n "$want_text" ] && ! printf '%s' "$out" | grep -qF "$want_text"; then
    problems+=("output did not contain \"$want_text\"")
  fi

  if [ ${#problems[@]} -eq 0 ]; then
    ok "$label"
  else
    bad "$label" "${problems[@]}" "step said: ${out:-<nothing>}"
  fi
}

# ---------------------------------------------------------------- the contract case
# The behaviour cases assert the step WRITES done=false. That only matters because every later
# step in the job runs on `done == 'false'` -- and an output that is never written compares as the
# empty string, so a step that writes nothing silently disables the whole release. This asserts
# the two halves still agree: the id, the output name, and the comparison.
#
# Deliberately strict about `== 'false'` rather than accepting `!= 'true'`. They differ exactly
# where it matters: against an unwritten output, `== 'false'` skips and `!= 'true'` runs.
contract_case() { # <step.sh -- unused, the contract is read from the YAML>
  local out
  out=$(python3 - "$WORKFLOW" <<'PY' 2>&1
import sys, re, yaml
doc = yaml.safe_load(open(sys.argv[1]))
steps = doc['jobs']['tag']['steps']

idx = [i for i, s in enumerate(steps) if s.get('name') == 'Tag already cut?']
assert len(idx) == 1, f"expected one 'Tag already cut?' step, found {len(idx)}"
gate = steps[idx[0]]

step_id = gate.get('id')
assert step_id, "the step has no id, so nothing downstream can read its output"

written = sorted(set(re.findall(r'^\s*echo\s+"(\w+)=', gate['run'], re.M)))
assert written == ['done'], f"expected the step to write exactly one output 'done', it writes {written}"

want = f"steps.{step_id}.outputs.done == 'false'"
later = steps[idx[0] + 1:]
assert later, "no steps follow the gate -- it decides nothing"

ungated = [s.get('name', '<unnamed>') for s in later if want not in str(s.get('if', ''))]
assert not ungated, f"these steps do not gate on \"{want}\": {ungated}"

print(f"{len(later)} downstream steps all gate on {want}")
PY
  )
  if [ $? -eq 0 ]; then
    ok "downstream steps read the output the step writes -- $out"
  else
    bad "downstream steps read the output the step writes" "$(printf '%s' "$out" | tail -3)"
  fi
}

# ---------------------------------------------------------------- the suite
suite() { # <step.sh>
  local step=$1

  # 1  the ordinary release: no tag with this version exists yet
  build_world
  run_case "no tag exists -> proceed" \
    "$step" 1.0.0 "$HEAD_SHA" 0 false

  # 2  a re-run of a tag this workflow cut (git tag -a => annotated)
  build_world; tag_on_origin v1.0.0 "$HEAD_SHA" annotated
  run_case "annotated tag at this commit -> genuine re-run" \
    "$step" 1.0.0 "$HEAD_SHA" 0 true "already points at this commit"

  # 3  a re-run where the tag was cut by hand (every flux tag today is lightweight)
  build_world; tag_on_origin v1.0.0 "$HEAD_SHA" lightweight
  run_case "lightweight tag at this commit -> genuine re-run" \
    "$step" 1.0.0 "$HEAD_SHA" 0 true "already points at this commit"

  # 4  the finding: a tag carrying this version but pointing elsewhere
  build_world; tag_on_origin v1.0.0 "$OTHER_SHA" annotated
  run_case "annotated tag at another commit -> refuse" \
    "$step" 1.0.0 "$HEAD_SHA" 1 unset "which is not this commit"

  # 5  the finding in the shape it took in production: master rolled back behind a hand-cut tag
  build_world; tag_on_origin v1.0.0 "$OTHER_SHA" lightweight
  run_case "lightweight tag at another commit -> refuse" \
    "$step" 1.0.0 "$HEAD_SHA" 1 unset "which is not this commit"

  # 6  a different version's tag must not be mistaken for ours
  build_world; tag_on_origin v0.9.0 "$OTHER_SHA" lightweight
  run_case "another version's tag -> proceed" \
    "$step" 1.0.0 "$HEAD_SHA" 0 false

  # 7  the lookup must be exact: v1.0 must not find v1.0.0
  build_world; tag_on_origin v1.0.0 "$OTHER_SHA" lightweight
  run_case "v1.0 must not match v1.0.0 -> proceed" \
    "$step" 1.0 "$HEAD_SHA" 0 false

  # 8  a transport failure is a loud death, never a silent "no tag"
  build_world
  git -C "$WORK/clone" remote set-url origin "$WORK/no-such-repo.git"
  run_case "origin unreachable -> die, do not assume 'no tag'" \
    "$step" 1.0.0 "$HEAD_SHA" 128 unset

  # 9  the job still reads what the step writes
  contract_case "$step"
}

# ---------------------------------------------------------------- mutations
# Each reintroduces one defect. A mutation the suite does not notice is a hole in the suite.
run_mutation() { # <label> <python statement mutating `s`> <minimum cases that must fail>
  local label=$1 mutator=$2 want_fail=$3
  cp "$WORK/step.sh" "$WORK/mutant.sh"
  python3 - "$WORK/mutant.sh" <<PY
import sys
p = sys.argv[1]
s = open(p).read()
$mutator
open(p, 'w').write(s)
PY
  PASS=0; FAIL=0; FAILED_CASES=()
  printf '\n== mutation: %s\n' "$label"
  suite "$WORK/mutant.sh" > "$WORK/mutant.log" 2>&1
  printf '   %d passed, %d failed' "$PASS" "$FAIL"
  if [ "$FAIL" -ge "$want_fail" ]; then
    printf '  -- caught (%s)\n' "$(IFS=,; echo "${FAILED_CASES[*]}")"
    MUT_OK=$((MUT_OK + 1))
  else
    printf '  -- NOT CAUGHT: the suite is blind to this defect\n'
    cat "$WORK/mutant.log"
    MUT_BAD=$((MUT_BAD + 1))
  fi
}

# ---------------------------------------------------------------- go
echo "workflow: $WORKFLOW"
extract_step "$WORK/step.sh" || exit 1
echo "extracted $(wc -l < "$WORK/step.sh" | tr -d ' ') lines of shell, verbatim"

echo
echo "== the step as it ships"
suite "$WORK/step.sh"
REAL_PASS=$PASS; REAL_FAIL=$FAIL

MUT_OK=0; MUT_BAD=0

# M1 -- the fix as proposed in review: peeled lookup only, and no "no tag" branch at all.
#       The two that matter: an ordinary release does nothing, and a hand-cut stale tag passes.
run_mutation "reviewed proposal (peeled only, no done=false branch)" \
  's = """set -eo pipefail
if EXISTING=$(git ls-remote --tags origin "refs/tags/v${VERSION}^{}" | cut -f1) && [ -n "$EXISTING" ]; then
  if [ "$EXISTING" = "$GITHUB_SHA" ]; then
    echo "done=true" >> "$GITHUB_OUTPUT"
  else
    echo "tag v${VERSION} already exists at ${EXISTING}, not this commit"; exit 1
  fi
fi
"""' 1

# M2 -- drop the fallback to the direct ref: blind to every lightweight tag.
run_mutation "peeled lookup only (drop the \${PEELED:-\$DIRECT} fallback)" \
  's = s.replace("EXISTING=${PEELED:-$DIRECT}", "EXISTING=${PEELED}")' 2

# M3 -- the original defect: any tag with the right name counts as done.
run_mutation "any existing tag counts as done (the original defect)" \
  's = chr(10).join("elif true; then" if l.startswith("elif [") else l for l in s.split(chr(10)))' 2

# M4 -- lose the failure guard: a transport error reads as "no tag".
run_mutation "no set -eo pipefail (transport error becomes 'no tag')" \
  's = s.replace("set -eo pipefail", "set +e")' 1

# M5 -- a glob instead of an exact ref: v1.0 starts finding v1.0.0.
run_mutation "glob the tag pattern (v1.0 matches v1.0.0)" \
  's = s.replace(chr(34) + "refs/tags/v${VERSION}" + chr(34), chr(34) + "refs/tags/v${VERSION}*" + chr(34))' 1

# M6 -- the contract half: downstream stops reading what the step writes.
cp "$WORKFLOW" "$WORK/workflow.orig"
python3 - "$WORKFLOW" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
open(p, 'w').write(s.replace("steps.existing.outputs.done == 'false'", "steps.existing.outputs.finished == 'false'", 1))
PY
run_mutation "one downstream step stops reading the output" 'pass' 1
cp "$WORK/workflow.orig" "$WORKFLOW"

echo
echo "================================================================"
printf 'as it ships : %d passed, %d failed\n' "$REAL_PASS" "$REAL_FAIL"
printf 'mutations   : %d caught, %d missed\n' "$MUT_OK" "$MUT_BAD"
if [ "$REAL_FAIL" -eq 0 ] && [ "$MUT_BAD" -eq 0 ]; then
  echo "GREEN"
  exit 0
fi
echo "RED"
exit 1
