const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { parentPort } = require('node:worker_threads');

async function runCommand(userCmd, options = {}) {
  const res = { error: null, stdout: null, stderr: null }
  const params = options.params || [];

  if (!userCmd) {
    res.error = new Error("Command must be present")
    return res
  }

  if (!Array.isArray(params) || !params.every((p) => typeof p === 'string')) {
    res.error = new Error("Invalid params for command, must be an Array of strings")
    return res;
  }

  const { runAsRoot, logError, ...execOptions } = options;

  if (runAsRoot) {
    params.unshift(userCmd);
    cmd = 'sudo';
  } else {
    cmd = userCmd;
  }

  const { stdout, stderr } = await execFile(cmd, params, execOptions).catch((err) => {
    const { stdout: errStdout, stderr: errStderr, ...error } = err;
    res.error = error;
    return { stdout: errStdout, stderr: errStderr };
  });

  res.stdout = stdout;
  res.stderr = stderr;

  return res;
}

parentPort.on('message', async (message) => {
  const { id, cmd, options } = message;
  const response = await runCommand(cmd, options)
  response.logError = options.logError;
  parentPort.postMessage({ id, response })
});
