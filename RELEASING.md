# Releasing FluxOS

A release is a reviewed pull request from `development` into `master`. That has not changed, and
neither has the review or the merge button.

What has changed is that a release now has to prove, before it merges, that its code is on the
signed list of approved FluxOS trees — and that the tag and the GitHub Release are cut for you
afterwards instead of by hand.

## Why there is a list at all

Every node checks its own code against a published list of approved fingerprints. A fingerprint is
an md5 over the `ZelBack` directory and nothing else — not `helpers/`, not `package.json`, not the
workflows.

A robot in [RunOnFlux/fluxhashes](https://github.com/RunOnFlux/fluxhashes) builds that list. Every
time a branch or tag in this repository moves, it fingerprints the tree at that branch's tip, adds
it to the list, and signs the result. It publishes to `hashes.runonflux.io`.

That is the whole reason releasing has a gate: the fleet follows `master`, so nothing should reach
`master` whose fingerprint is not already published and signed.

## Cutting a release

**1. Bump the version on `development`.** `package.json`, as before.

**2. Add the fingerprint to `helpers/hashes.json` on `development`.** This is the step that used to
happen *after* the merge, as a commit straight to `master`. It now rides the release PR.

Compute it from a clean checkout of `development`:

```sh
find ./ZelBack -type f -exec md5sum {} + | awk '{print $1}' | LC_ALL=C sort | md5sum | awk '{printf $1}'
```

Adding it to `helpers/hashes.json` does not change the fingerprint, because the fingerprint only
covers `ZelBack`. So there is no chicken-and-egg — compute it, commit it, and it is still correct.

(`helpers/hashes.json` is the fallback list the older benchmark reads when it cannot reach central.
This step retires when that version of the benchmark does.)

**3. Open the PR, `development` → `master`, and get it reviewed.** As before.

**4. Merge it.** As before.

## What the checks do

Two workflows. Neither of them can merge anything or push anything; the gate is read-only.

**`release-gate`** runs on the pull request and judges the *merge preview* — what `master` will
actually hold once the PR merges, not the PR branch alone. It checks four things:

| check | what it means |
|---|---|
| the version moves forward | `package.json` is strictly newer than `master`'s, compared numerically |
| the merged `ZelBack` is a tree the signer can have seen | `master` holds no `ZelBack` changes that `development` is missing |
| the fingerprint is in the signed document | central is serving a validly signed list, and the merged tree's fingerprint is in it |
| the fallback list carries it | `helpers/hashes.json` has the entry from step 2 |

**`release-tag`** runs after the merge, on `master`. It re-verifies the merged tree against the
signed document — this is the authoritative check, because it judges what `master` actually holds —
then cuts the tag and the GitHub Release, and asks the robot to record the tag against the
fingerprint.

A push to `master` that does not change the version is not a release, and `release-tag` does
nothing.

## When something goes red

**"the candidate version does not move past master"** — bump `package.json` in the release PR.

**"master carries ZelBack changes that are not on development"** — someone committed code straight
to `master`. The merged tree then exists on no branch, so the robot has never fingerprinted it and
never will. Merge `master` into `development` and re-run. Waiting will not help.

**"the tree hash is not in the signed document"** — the robot has not caught up with
`development`'s tip yet. It reconciles on every push and on a daily sweep, so this normally clears
within minutes. Re-run the check.

**"central is not serving a validly signed hash list"** — `hashes.runonflux.io` is not answering
with a signed document. That is an infrastructure problem, not a problem with your release. The
gate is deliberately strict here: a gate that passes when its source is missing is not a gate.

**"helpers/hashes.json does not contain …"** — step 2 was missed.

**`release-tag` fails after the merge** — the release is on `master` and the fleet has it, but no
tag was cut. Nothing is half-made: `master` holds the tree the gate already verified. Read the run
to see which check failed before deciding whether to re-run it or cut the tag by hand.

**`release-tag` says a tag already exists at another commit** — a tag with this version number was
cut by hand, or `master` was rolled back behind one. Resolve the tag, then re-run. The workflow
refuses rather than skipping, because skipping would mean the merged tree was never verified.

## Things that are no longer done by hand

- Adding the fingerprint to `helpers/hashes.json` after the merge. It rides the PR now.
- Creating the `vX.Y.Z` tag.
- Creating the GitHub Release.

## Please do not commit to `master`

Every commit that lands on `master` outside a release PR makes `master` and `development` diverge.
Commits that only touch `helpers/` or `package.json` are harmless to the gate, since the
fingerprint only covers `ZelBack` — but a commit that touches `ZelBack` produces a merged tree that
exists on no branch, which nothing can ever sign, and blocks the next release until `master` is
merged back into `development`.

## Tests

The steps in both workflows are covered by `tests/ci/release-workflows.sh`. It runs offline with no
secrets, extracts the steps from the workflow files verbatim rather than copying them, and
mutation-tests its own assertions. Run it after changing either workflow.
