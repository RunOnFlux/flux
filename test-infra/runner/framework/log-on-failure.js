import { afterEach, after } from 'mocha';

export function dumpLogsOnFailure(getEnv) {
  let dumped = false;

  function dump() {
    const env = getEnv();
    if (!env) return;
    dumped = true;
    for (let i = 0; i < env.nodeCount; i++) {
      const lines = env.containers?.fluxNodes?.[i]?.logCollector ? env.nodeLogLines(i) : [];
      if (lines.length) {
        console.log(`\n--- Node ${i} logs (${lines.length} lines) ---`);
        lines.forEach((l) => console.log(l));
      }
      const client = env.clients[i];
      if (client) {
        const events = client.getEventBuffer();
        if (events.length) {
          console.log(`\n--- Node ${i} SSE events (${events.length}) ---`);
          events.forEach((e) => console.log(`  ${e.event}: ${JSON.stringify(e.data)}`));
        }
      }
    }
  }

  afterEach(function () {
    if (this.currentTest.state === 'failed') dump();
  });

  // afterEach never fires for a before/after-all HOOK failure, which is exactly
  // when setup blew up and the node logs matter most. As a backstop, dump in the
  // after-all hook when nothing passed and we haven't already dumped — a strong
  // signal that a setup hook failed.
  after(function () {
    if (dumped) return;
    const tests = this.test?.parent?.tests || [];
    if (tests.length > 0 && !tests.some((t) => t.state === 'passed')) dump();
  });
}
