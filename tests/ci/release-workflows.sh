#!/usr/bin/env bash
#
# Tests for the release workflows: .github/workflows/release-gate.yml and release-tag.yml.
#
# Three steps are covered, each of which fails silently or misleadingly when it is wrong:
#
#   release-tag  "Tag already cut?" -- decides whether a release that has just landed on master
#     still needs verifying and tagging. Wrong in the permissive direction, the job skips the
#     merged-tree verification, cuts no tag, and reports green.
#
#   release-gate "Version moves forward" -- a version the comparison cannot read must be refused,
#     not judged by whichever part happens to differ.
#
#   release-gate "The merged ZelBack is a tree the signer can have seen" -- refuses a release whose
#     merged tree exists on no branch, because no signing run can ever cover it. Wrong, and a
#     release stalls behind a message telling the reader to wait for something that never comes.
#
# Requires: git, python3 with pyyaml, node, jq.
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
# Usage: tests/ci/release-workflows.sh [path-to-repo]

set -uo pipefail

REPO=${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
TAG_WF="$REPO/.github/workflows/release-tag.yml"
GATE_WF="$REPO/.github/workflows/release-gate.yml"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
FAILED_CASES=()

# ---------------------------------------------------------------- extract the step, verbatim
extract_step() { # <workflow> <job> <step name> <outfile>
  python3 - "$@" <<'PY'
import sys, yaml
wf, job, name, out = sys.argv[1:5]
doc = yaml.safe_load(open(wf))
steps = [s for s in doc['jobs'][job]['steps'] if s.get('name') == name]
assert len(steps) == 1, f"expected one {name!r} step in {job}, found {len(steps)}"
run = steps[0]['run']
assert '${{' not in run, f"{name!r} interpolates ${{{{ }}}} into the shell -- it cannot be run verbatim"
open(out, 'w').write(run)
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
  out=$(python3 - "$TAG_WF" <<'PY' 2>&1
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

# ---------------------------------------------------------------- release-tag suite
tag_suite() { # <step.sh>
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



# ---------------------------------------------------------------- release-gate: the version world
# A bare origin whose master holds one package.json version, and a clone holding another. The step
# fetches master, reads both, and judges.
version_world() { # <master version> <candidate version>
  rm -rf "$WORK/vorigin.git" "$WORK/vsrc" "$WORK/vclone"
  mkdir -p "$WORK/vsrc"
  (
    cd "$WORK/vsrc"
    git init -q -b master . && git config user.email t@t && git config user.name t
    printf '{"version":"%s"}\n' "$1" > package.json
    git add package.json && git commit -qm master
  )
  git clone -q --bare "$WORK/vsrc" "$WORK/vorigin.git"
  git clone -q "file://$WORK/vorigin.git" "$WORK/vclone"
  printf '{"version":"%s"}\n' "$2" > "$WORK/vclone/package.json"
}

# version_case <label> <step.sh> <master> <candidate> <expect_exit> <must contain>
version_case() {
  local label=$1 step=$2 base=$3 cand=$4 want_exit=$5 want_text=$6
  version_world "$base" "$cand"
  local out rc
  out=$(cd "$WORK/vclone" && bash "$step" 2>&1)
  rc=$?
  local problems=()
  [ "$rc" = "$want_exit" ] || problems+=("exit $rc, wanted $want_exit")
  if [ -n "$want_text" ] && ! printf '%s' "$out" | grep -qF "$want_text"; then
    problems+=("output did not contain \"$want_text\"")
  fi
  if [ ${#problems[@]} -eq 0 ]; then
    ok "$label"
  else
    bad "$label" "${problems[@]}" "step said: ${out:-<nothing>}"
  fi
}

version_suite() { # <step.sh>
  local step=$1
  version_case "8.17.1 -> 8.17.2 moves forward"          "$step" 8.17.1 8.17.2      0 "candidate: 8.17.2"
  version_case "8.17.1 -> 8.17.10 is newer, not older"   "$step" 8.17.1 8.17.10     0 "candidate: 8.17.10"
  version_case "the same version does not move"          "$step" 8.17.1 8.17.1      1 "does not move past master"
  version_case "going backwards is refused"              "$step" 8.18.0 8.17.9      1 "does not move past master"
  # the three the old comparison judged by whichever part happened to differ
  version_case "8.17.2-rc1 is refused by shape"          "$step" 8.17.1 8.17.2-rc1  1 "not three numeric parts"
  version_case "8.18.0-rc1 is refused by shape"          "$step" 8.17.1 8.18.0-rc1  1 "not three numeric parts"
  version_case "8.18 (two parts) is refused by shape"    "$step" 8.17.1 8.18        1 "not three numeric parts"
}

# ---------------------------------------------------------------- release-gate: the preview world
# origin holds master and a feature branch, with refs/pull/1/head at the feature tip exactly as
# GitHub publishes it. The clone then checks out a real merge of the two -- the merge preview
# actions/checkout hands the gate. A file:// remote, so --depth is honoured rather than silently
# ignored as it is for a local path.
gate_world() { # <what master gained on its own: none|helpers|zelback>
  local extra=$1
  rm -rf "$WORK/gorigin.git" "$WORK/gsrc" "$WORK/gclone"
  mkdir -p "$WORK/gsrc"
  (
    cd "$WORK/gsrc"
    git init -q -b master . && git config user.email t@t && git config user.name t
    mkdir -p ZelBack/src helpers
    echo base > ZelBack/src/app.js
    echo '{}' > helpers/hashes.json
    git add ZelBack helpers && git commit -qm base

    git checkout -q -b feature
    echo feature > ZelBack/src/feature.js
    git add ZelBack && git commit -qm "feature work on development"

    git checkout -q master
    case "$extra" in
      helpers) echo '[]' > helpers/nodes.json
               git add helpers && git commit -qm "node data straight to master" ;;
      zelback) echo hotfix > ZelBack/src/hotfix.js
               git add ZelBack && git commit -qm "hotfix straight to master" ;;
    esac
  )
  git clone -q --bare "$WORK/gsrc" "$WORK/gorigin.git"
  git -C "$WORK/gsrc" push -q "$WORK/gorigin.git" feature:refs/pull/1/head
  git clone -q "file://$WORK/gorigin.git" "$WORK/gclone"
  git -C "$WORK/gclone" checkout -q master
  git -C "$WORK/gclone" -c user.email=t@t -c user.name=t merge -q --no-edit origin/feature
}

# gate_case <label> <step.sh> <expect_exit> <must contain|""> [must NOT contain]
gate_case() {
  local label=$1 step=$2 want_exit=$3 want_text=$4 not_text=${5:-}
  local out rc
  out=$(cd "$WORK/gclone" && PR_NUMBER=1 GITHUB_HEAD_REF=feature bash "$step" 2>&1)
  rc=$?
  local problems=()
  [ "$rc" = "$want_exit" ] || problems+=("exit $rc, wanted $want_exit")
  if [ -n "$want_text" ] && ! printf '%s' "$out" | grep -qF "$want_text"; then
    problems+=("output did not contain \"$want_text\"")
  fi
  if [ -n "$not_text" ] && printf '%s' "$out" | grep -qF "$not_text"; then
    problems+=("output wrongly contained \"$not_text\"")
  fi
  if [ ${#problems[@]} -eq 0 ]; then
    ok "$label"
  else
    bad "$label" "${problems[@]}" "step said: ${out:-<nothing>}"
  fi
}

gate_suite() { # <step.sh>
  local step=$1

  # 1  the ordinary release: master holds nothing of its own
  gate_world none
  gate_case "master adds nothing -> pass" \
    "$step" 0 "is this PR head's ZelBack"

  # 2  the routine habit: version metadata and node data land on master directly. Outside the
  #    hashed tree, so the merged ZelBack is still the head's and the gate must stay quiet.
  gate_world helpers
  gate_case "master diverges under helpers/ only -> pass" \
    "$step" 0 "is this PR head's ZelBack"

  # 3  the case worth refusing: master holds ZelBack the head does not, so the merged tree is on
  #    no branch and no signing run can cover it. The message must name the remedy.
  gate_world zelback
  gate_case "master diverges under ZelBack -> refuse, naming the fix" \
    "$step" 1 "merge master into feature"

  # 4  a fetch failure must die on its own cause, never be reported as divergence
  gate_world none
  git -C "$WORK/gclone" remote set-url origin "file://$WORK/no-such-repo.git"
  gate_case "origin unreachable -> die, do not claim divergence" \
    "$step" 128 "" "master carries ZelBack changes"
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
  "$SUITE_FN" "$WORK/mutant.sh" > "$WORK/mutant.log" 2>&1
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
MUT_OK=0; MUT_BAD=0
TOTAL_PASS=0; TOTAL_FAIL=0

# run_mutation leaves PASS/FAIL holding the mutant's results, so a suite that does not reset
# first would count them again as its own.
run_suite() { # <suite fn> <step.sh>
  PASS=0; FAIL=0; FAILED_CASES=()
  "$1" "$2"
  TOTAL_PASS=$((TOTAL_PASS + PASS)); TOTAL_FAIL=$((TOTAL_FAIL + FAIL))
}

# ================================================================ release-tag :: Tag already cut?
echo "== release-tag.yml :: Tag already cut?"
extract_step "$TAG_WF" tag 'Tag already cut?' "$WORK/step.sh" || exit 1
SUITE_FN=tag_suite
run_suite tag_suite "$WORK/step.sh"

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
cp "$TAG_WF" "$WORK/workflow.orig"
python3 - "$TAG_WF" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
open(p, 'w').write(s.replace("steps.existing.outputs.done == 'false'", "steps.existing.outputs.finished == 'false'", 1))
PY
run_mutation "one downstream step stops reading the output" 'pass' 1
cp "$WORK/workflow.orig" "$TAG_WF"

# ================================================================ release-gate :: version check
echo
echo "== release-gate.yml :: Version moves forward"
extract_step "$GATE_WF" gate 'Version moves forward' "$WORK/step.sh" || exit 1
SUITE_FN=version_suite
run_suite version_suite "$WORK/step.sh"

# V1 -- drop the end anchor: a prerelease suffix stops being seen, and 8.18.0-rc1 passes again.
run_mutation "regex loses its end anchor (prereleases slip through)" \
  's = s.replace("(\\d+)$/", "(\\d+)/")' 1

# V2 -- make every part optional: 8.18 parses as 8.18.0 and passes again.
run_mutation "regex parts become optional (a two-part version passes)" \
  's = s.replace("^(\\d+)\\.(\\d+)\\.(\\d+)$", "^(\\d*)\\.?(\\d*)\\.?(\\d*)$")' 1

# ================================================ release-gate :: the merged ZelBack is signable
echo
echo "== release-gate.yml :: The merged ZelBack is a tree the signer can have seen"
extract_step "$GATE_WF" gate 'The merged ZelBack is a tree the signer can have seen' "$WORK/step.sh" || exit 1
SUITE_FN=gate_suite
run_suite gate_suite "$WORK/step.sh"

# G1 -- compare whole trees instead of the ZelBack subtree. Master diverging under helpers/ is
#       routine and cannot change the hash; a whole-tree compare blocks every release after one.
run_mutation "compare whole trees, not ZelBack (over-fires on helpers/)" \
  's = s.replace("HEAD:ZelBack", "HEAD^{tree}")' 1

# G2 -- stop comparing at all: the stall this step exists to pre-empt comes back.
run_mutation "never refuse (drop the comparison)" \
  's = chr(10).join("if false; then" if (l.strip().startswith("if [") and "PREVIEW" in l) else l for l in s.split(chr(10)))' 1

# G3 -- lose the failure guard: an unreachable origin gets reported as divergence.
run_mutation "no set -eo pipefail (a failed fetch reads as divergence)" \
  's = s.replace("set -eo pipefail", "set +e")' 1

echo
echo "================================================================"
printf 'as they ship : %d passed, %d failed\n' "$TOTAL_PASS" "$TOTAL_FAIL"
printf 'mutations    : %d caught, %d missed\n' "$MUT_OK" "$MUT_BAD"
if [ "$TOTAL_FAIL" -eq 0 ] && [ "$MUT_BAD" -eq 0 ]; then
  echo "GREEN"
  exit 0
fi
echo "RED"
exit 1
