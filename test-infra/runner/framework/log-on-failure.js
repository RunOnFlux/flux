export function dumpLogsOnFailure(getEnv) {
  afterEach(function () {
    if (this.currentTest.state !== 'failed') return;
    const env = getEnv();
    if (!env) return;
    for (let i = 0; i < env.nodeCount; i++) {
      const lines = env.nodeLogLines(i);
      if (!lines.length) continue;
      console.log(`\n--- Node ${i} logs (${lines.length} lines) ---`);
      lines.forEach((l) => console.log(l));
    }
  });
}
