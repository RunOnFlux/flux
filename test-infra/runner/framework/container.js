import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function containerName(nodeNum) {
  return `flux-e2e-fluxos-${String(nodeNum).padStart(2, '0')}-1`;
}

export async function restartContainer(nodeNum) {
  await execFileAsync('docker', ['restart', containerName(nodeNum)], { timeout: 60000 });
}

export async function stopContainer(nodeNum) {
  await execFileAsync('docker', ['stop', containerName(nodeNum)], { timeout: 30000 });
}

export async function startContainer(nodeNum) {
  await execFileAsync('docker', ['start', containerName(nodeNum)], { timeout: 30000 });
}

export async function isContainerRunning(nodeNum) {
  const { stdout } = await execFileAsync('docker', [
    'inspect', '--format', '{{.State.Running}}', containerName(nodeNum),
  ]);
  return stdout.trim() === 'true';
}

export async function containerUptime(nodeNum) {
  const { stdout } = await execFileAsync('docker', [
    'inspect', '--format', '{{.State.StartedAt}}', containerName(nodeNum),
  ]);
  const started = new Date(stdout.trim());
  return Date.now() - started.getTime();
}

export async function execInContainer(nodeNum, command, { timeout = 30000 } = {}) {
  const args = Array.isArray(command) ? command : ['sh', '-c', command];
  const { stdout, stderr } = await execFileAsync(
    'docker', ['exec', containerName(nodeNum), ...args],
    { timeout, maxBuffer: 5 * 1024 * 1024 },
  );
  return { stdout, stderr };
}

export async function listAppContainers(nodeNum) {
  const { stdout } = await execInContainer(nodeNum,
    'docker ps --format "{{.Names}}\t{{.Status}}\t{{.Image}}" 2>/dev/null || echo ""',
  );
  return stdout.trim().split('\n')
    .filter((line) => line && !line.includes('NAMES'))
    .map((line) => {
      const [name, status, image] = line.split('\t');
      return { name, status, image };
    })
    .filter((c) => c.name);
}

export async function isAppContainerRunning(nodeNum, appName) {
  const containers = await listAppContainers(nodeNum);
  return containers.some((c) => c.name.includes(appName) && c.status?.startsWith('Up'));
}

export { containerName };
