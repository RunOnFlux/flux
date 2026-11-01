/*
 * A node's flux.conf: the file its FluxOS reads fluxd's settings from at start
 * (FLUXD_CONFIG_PATH). Each node holds its own copy inside its container, and
 * env.restartNode keeps it, so an edit is that node's alone and takes effect at
 * its next start.
 */
import { execInContainer } from './container.js';

/**
 * Remove a key from a node's flux.conf, and check it is gone.
 * @param {object} container The node's container.
 * @param {string} key A flux.conf key, such as `insightexplorer`.
 */
export async function removeFluxdConfKey(container, key) {
  if (!/^[a-z]+$/.test(key)) throw new Error(`removeFluxdConfKey: ${key} is not a flux.conf key`);
  const r = await execInContainer(container, `test -f "$FLUXD_CONFIG_PATH" && sed -i '/^${key}=/d' "$FLUXD_CONFIG_PATH" && ! grep -q '^${key}=' "$FLUXD_CONFIG_PATH"`);
  if (r.exitCode !== 0) throw new Error(`removeFluxdConfKey: ${key} could not be removed from the node's flux.conf: ${r.output}`);
}
