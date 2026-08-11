import { afterEach, after } from 'mocha';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { activeTestEnvs } from './test-env.js';

const LOG_ROOT = join(process.cwd(), 'test-logs');

function sanitize(label) {
  return (label || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

// Dump each node's logs and SSE events to its OWN file under test-logs/<label>/,
// plus one file per infra container (mongo, the stubs, the registry). A merged
// stdout dump interleaves all nodes, which makes "which node did what" impossible
// to read (every node logs the same identifiers every cycle). Per-node files keep
// each node's timeline clean; stdout only gets a pointer to them.
//
// The infra files are what explains an INFRA-DEAD run: a mongo that takes SIGSEGV
// writes its own backtrace, and until it was captured here that evidence was
// thrown away with the container.
export function dumpLogsOnFailure(getEnv) {
  let dumped = false;

  async function dump(label) {
    // The suite's own env when it was assigned; otherwise every env this process
    // booted (createTestEnv threw mid-boot — the suite's variable never existed,
    // but the partially-built env still holds the log collectors and SSE buffers;
    // see activeTestEnvs in test-env.js).
    const own = getEnv();
    const envs = own ? [own] : activeTestEnvs();
    if (!envs.length) return;
    dumped = true;
    const dir = join(LOG_ROOT, sanitize(label));
    try {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.log(`log-on-failure: could not create ${dir}: ${err.message}`);
      return;
    }

    // Node diagnostics are already in memory; infra logs come off the docker
    // daemon, so they are fetched up front and written alongside them. Each entry
    // is best-effort (see env.infraDiagnostics) — a log fetch that failed carries
    // an `error` and is reported, never thrown.
    const infraByEnv = await Promise.all(envs.map((env) => env.infraDiagnostics()));

    const written = [];
    envs.forEach((env, e) => {
      const prefix = envs.length > 1 ? `env${e + 1}-` : '';
      for (const { name, text, error } of infraByEnv[e]) {
        if (error) {
          console.log(`log-on-failure: no logs for infra container ${name}: ${error}`);
          continue;
        }
        if (!text.trim()) continue;
        const file = join(dir, `${prefix}infra-${sanitize(name)}.log`);
        writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
        written.push(`${file} (${text.trimEnd().split('\n').length} lines)`);
      }
      for (const { index, ip, lines, events } of env.nodeDiagnostics()) {
        if (!lines.length && !events.length) continue;

        const parts = [`=== Node ${index} (ip ${ip ?? '?'}) — ${lines.length} log lines ===`];
        parts.push(...lines);
        if (events.length) {
          parts.push('', `=== Node ${index} SSE events (${events.length}) ===`);
          events.forEach((ev) => parts.push(`${ev.event}: ${JSON.stringify(ev.data)}`));
        }
        const file = join(dir, `${prefix}node-${String(index).padStart(2, '0')}.log`);
        writeFileSync(file, `${parts.join('\n')}\n`);
        written.push(`${file} (${lines.length} lines, ${events.length} events)`);
      }
    });

    if (written.length) {
      console.log(`\n--- per-container logs written to ${dir} ---`);
      written.forEach((w) => console.log(`  ${w}`));
    } else {
      console.log(`\n--- no container logs captured for ${label} ---`);
    }
  }

  // DUMP_LOGS=always dumps per-node logs after every test (pass or fail), not just
  // failures — used to measure timing on green runs while investigating flakes.
  const always = process.env.DUMP_LOGS === 'always';

  afterEach(async function () {
    if (always || this.currentTest.state === 'failed') await dump(this.currentTest.fullTitle());
  });

  // afterEach never fires for a before/after-all HOOK failure, which is exactly
  // when setup blew up and the node logs matter most. As a backstop, dump in the
  // after-all hook when nothing passed and we haven't already dumped — a strong
  // signal that a setup hook failed. Tests are counted through nested describes
  // so a top-level hook failure is caught even when every `it` lives in a child.
  after(async function () {
    if (dumped) return;
    const root = this.test?.parent;
    if (!root) return;
    const anyTests = (s) => s.tests.length > 0 || s.suites.some(anyTests);
    const anyPassed = (s) => s.tests.some((t) => t.state === 'passed') || s.suites.some(anyPassed);
    if (anyTests(root) && !anyPassed(root)) {
      await dump(root.fullTitle?.() || root.title || 'setup-hook');
    }
  });
}
