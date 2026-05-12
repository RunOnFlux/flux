import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function containerName(nodeNum) {
  return `flux-e2e-fluxos-${String(nodeNum).padStart(2, '0')}-1`;
}

export async function getLogs(nodeNum, { since, tail } = {}) {
  const args = ['logs'];
  if (since) args.push('--since', since);
  if (tail) args.push('--tail', String(tail));
  args.push(containerName(nodeNum));

  const { stdout, stderr } = await execFileAsync('docker', args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout + stderr;
}

export async function grepLogs(nodeNum, pattern, opts = {}) {
  const logs = await getLogs(nodeNum, opts);
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'g');
  return logs.split('\n').filter((line) => regex.test(line));
}

export async function countPattern(nodeNum, pattern, opts = {}) {
  const matches = await grepLogs(nodeNum, pattern, opts);
  return matches.length;
}

export async function hasLogLine(nodeNum, pattern, opts = {}) {
  const matches = await grepLogs(nodeNum, pattern, opts);
  return matches.length > 0;
}

export async function waitForLog(nodeNum, pattern, { timeout = 60000, interval = 2000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await hasLogLine(nodeNum, pattern, { since: `${Math.floor(timeout / 1000) + 10}s` })) {
      return true;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timeout waiting for log pattern "${pattern}" on node ${nodeNum}`);
}
