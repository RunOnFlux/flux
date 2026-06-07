import { afterEach, after } from 'mocha';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const LOG_ROOT = join(process.cwd(), 'test-logs');

function sanitize(label) {
  return (label || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

// Dump each node's logs and SSE events to its OWN file under test-logs/<label>/.
// A merged stdout dump interleaves all nodes, which makes "which node did what"
// impossible to read (every node logs the same identifiers every cycle). Per-node
// files keep each node's timeline clean; stdout only gets a pointer to them.
export function dumpLogsOnFailure(getEnv) {
  let dumped = false;

  function dump(label) {
    const env = getEnv();
    if (!env) return;
    dumped = true;
    const dir = join(LOG_ROOT, sanitize(label));
    try {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.log(`log-on-failure: could not create ${dir}: ${err.message}`);
      return;
    }

    const written = [];
    for (let i = 0; i < env.nodeCount; i++) {
      const lines = env.containers?.fluxNodes?.[i]?.logCollector ? env.nodeLogLines(i) : [];
      const client = env.clients[i];
      const events = client ? client.getEventBuffer() : [];
      if (!lines.length && !events.length) continue;

      const parts = [`=== Node ${i} (ip ${env.clients?.[i]?.ip ?? '?'}) — ${lines.length} log lines ===`];
      parts.push(...lines);
      if (events.length) {
        parts.push('', `=== Node ${i} SSE events (${events.length}) ===`);
        events.forEach((e) => parts.push(`${e.event}: ${JSON.stringify(e.data)}`));
      }
      const file = join(dir, `node-${String(i).padStart(2, '0')}.log`);
      writeFileSync(file, `${parts.join('\n')}\n`);
      written.push(`${file} (${lines.length} lines, ${events.length} events)`);
    }

    if (written.length) {
      console.log(`\n--- per-node logs written to ${dir} ---`);
      written.forEach((w) => console.log(`  ${w}`));
    } else {
      console.log(`\n--- no node logs captured for ${label} ---`);
    }
  }

  // DUMP_LOGS=always dumps per-node logs after every test (pass or fail), not just
  // failures — used to measure timing on green runs while investigating flakes.
  const always = process.env.DUMP_LOGS === 'always';

  afterEach(function () {
    if (always || this.currentTest.state === 'failed') dump(this.currentTest.fullTitle());
  });

  // afterEach never fires for a before/after-all HOOK failure, which is exactly
  // when setup blew up and the node logs matter most. As a backstop, dump in the
  // after-all hook when nothing passed and we haven't already dumped — a strong
  // signal that a setup hook failed.
  after(function () {
    if (dumped) return;
    const tests = this.test?.parent?.tests || [];
    if (tests.length > 0 && !tests.some((t) => t.state === 'passed')) {
      dump(this.test?.parent?.fullTitle?.() || this.test?.parent?.title || 'setup-hook');
    }
  });
}
