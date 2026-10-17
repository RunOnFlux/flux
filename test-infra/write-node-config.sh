#!/bin/bash
# Writes the node's FluxOS config overlay, ZelBack/config/local.js: the per-node file
# NODE_CONFIG_DIR names, with the runner's overrides (FLUX_TEST_CONFIG, JSON) merged
# over it. Run by the entrypoint at boot and by an in-place upgrade, which takes the
# new build's per-node file the same way.
#
# app.js hardcodes NODE_CONFIG_DIR to ZelBack/config/ (cannot be overridden from env
# - fluxbenchd hashes that directory for tamper detection), so the test config is
# overlaid into it.
set -e

if [ -n "$NODE_CONFIG_DIR" ] && [ -d "$NODE_CONFIG_DIR" ]; then
  cp "$NODE_CONFIG_DIR"/default.js /flux/ZelBack/config/local.js
  cp "$(dirname "$NODE_CONFIG_DIR")/shared.js" /flux/ZelBack/ 2>/dev/null || true
fi

# Merged OVER the per-node file, which is where the per-node database names come
# from - replacing that file rather than merging would take them with it. A file
# rather than NODE_CONFIG: the config package merges that variable over every file
# whatever directory is pinned, so it could redirect any endpoint without touching
# the directory fluxbenchd hashes, and the entry points delete it.
if [ -n "$FLUX_TEST_CONFIG" ]; then
  node -e '
    const fs = require("fs");
    const target = "/flux/ZelBack/config/local.js";
    const base = fs.existsSync(target) ? require(target) : {};
    const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v);
    const merge = (a, b) => {
      const out = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = isPlain(v) && isPlain(a[k]) ? merge(a[k], v) : v;
      return out;
    };
    const merged = merge(base, JSON.parse(process.env.FLUX_TEST_CONFIG));
    fs.writeFileSync(target, `module.exports = ${JSON.stringify(merged, null, 2)};\n`);
  '
fi
