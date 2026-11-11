// Debug logging for every node's real syncthing, kept on for a whole run.
//
// E2E_SYNCTHING_TRACE names syncthing's log packages, comma-separated (for example
// `model,scanner`; GET /rest/system/loglevels lists them). Unset, nothing runs. Set,
// each node's daemon is checked every TRACE_CHECK_MS and any named package not at
// DEBUG is set to it, so a daemon that restarted - which starts at its default
// levels - is traced again within one check. The output lands in the node's
// syncthing log, which the failure dump collects.
import { execInContainer } from './container.js';
import { SYNCTHING_HOME } from './syncthing-real.js';

const TRACE_CHECK_MS = 5000;

/**
 * The packages E2E_SYNCTHING_TRACE names.
 * @returns {string[]}
 */
export function tracedPackages() {
  const names = (process.env.E2E_SYNCTHING_TRACE || '').split(',').map((name) => name.trim()).filter(Boolean);
  const malformed = names.filter((name) => !/^[a-z][a-z0-9/]*$/.test(name));
  if (malformed.length) throw new Error(`E2E_SYNCTHING_TRACE names something that is not a syncthing log package: ${malformed.join(', ')}`);
  return names;
}

// Sets every package in $PACKAGES that is not at DEBUG, reading the daemon's levels
// first so a check that changes nothing writes nothing to its log. Silent when the
// node has no daemon answering.
const TRACE_SCRIPT = `
H="${SYNCTHING_HOME}"
K=$(sed -n 's|.*<apikey>\\(.*\\)</apikey>.*|\\1|p' "$H/config.xml" 2>/dev/null | head -1)
[ -n "$K" ] || exit 0
L=$(curl -sS -m 5 -H "X-API-Key: $K" http://127.0.0.1:8384/rest/system/loglevels 2>/dev/null) || exit 0
BODY=$(printf '%s' "$L" | python3 -c '
import json, os, sys
levels = json.load(sys.stdin).get("levels", {})
want = {p: "DEBUG" for p in os.environ["PACKAGES"].split(",") if levels.get(p) != "DEBUG"}
print(json.dumps(want) if want else "")
' 2>/dev/null) || exit 0
[ -n "$BODY" ] || exit 0
curl -sS -m 5 -X POST -H "X-API-Key: $K" -H "Content-Type: application/json" -d "$BODY" http://127.0.0.1:8384/rest/system/loglevels >/dev/null 2>&1
exit 0
`;

/**
 * Keeps the named packages at DEBUG on every node until the returned stop is called.
 * @param {object[]} clients The env's node clients
 * @param {string[]} packages
 * @returns {() => void} stop
 */
export function startSyncthingTrace(clients, packages) {
  if (!packages.length) return () => {};
  const script = `PACKAGES='${packages.join(',')}'; export PACKAGES; ${TRACE_SCRIPT}`;
  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      await Promise.all(clients.filter((client) => client?.container)
        .map((client) => execInContainer(client.container, script).catch(() => null)));
    } finally {
      checking = false;
    }
  };
  check();
  const timer = setInterval(check, TRACE_CHECK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
