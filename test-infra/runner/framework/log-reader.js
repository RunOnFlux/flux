import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { throwIfInfraDead, sleepUnlessInfraDead } from './infra-death.js';

const execFileAsync = promisify(execFile);

export async function getLogs(containerId, { since, tail } = {}) {
  const args = ['logs'];
  if (since) args.push('--since', since);
  if (tail) args.push('--tail', String(tail));
  args.push(containerId);

  const { stdout, stderr } = await execFileAsync('docker', args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout + stderr;
}

export async function grepLogs(containerId, pattern, opts = {}) {
  const logs = await getLogs(containerId, opts);
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'g');
  return logs.split('\n').filter((line) => regex.test(line));
}

export async function countPattern(containerId, pattern, opts = {}) {
  const matches = await grepLogs(containerId, pattern, opts);
  return matches.length;
}

export async function hasLogLine(containerId, pattern, opts = {}) {
  const matches = await grepLogs(containerId, pattern, opts);
  return matches.length > 0;
}

export async function waitForLog(containerId, pattern, { timeout = 60000, interval = 2000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    // an infra death voids the run - don't spend the budget proving it
    throwIfInfraDead();
    if (await hasLogLine(containerId, pattern, { since: `${Math.floor(timeout / 1000) + 10}s` })) {
      return true;
    }
    await sleepUnlessInfraDead(interval);
  }
  throw new Error(`Timeout waiting for log pattern "${pattern}" on container ${containerId}`);
}
