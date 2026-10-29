#!/usr/bin/env bash
#
# Runs the unit suite as CI does, in containers of this run's own (compose.yaml).
#
#   tests/images/run-unit.sh                                   every test under tests/unit
#   tests/images/run-unit.sh tests/unit/dockerService.test.js  one module
#   tests/images/run-unit.sh -g 'some test' tests/unit/x.test.js
#
# Each run is its own compose project, removed with its volumes on exit, so
# runs on one host never touch each other's containers or the host's Docker.
# Exits with mocha's status.

set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project="fluxos-unit-$(date +%s)-$$"

compose() {
  docker compose -p "$project" -f "$here/compose.yaml" --profile auto "$@"
}

trap 'compose down -v --remove-orphans >/dev/null 2>&1' EXIT

compose run --build --rm tester "$@"
