import { afterEach } from 'mocha';

export function dumpLogsOnFailure(getEnv) {
  afterEach(function () {
    if (this.currentTest.state !== 'failed') return;
    const env = getEnv();
    if (!env) return;
    for (let i = 0; i < env.nodeCount; i++) {
      const lines = env.nodeLogLines(i);
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
  });
}
