const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { spawn } = require('node:child_process')
const { parentPort } = require('node:worker_threads');

async function runCommand(userCmd, options = {}) {
  const res = { error: null, stdout: null, stderr: null }
  const params = options.params || [];

  if (!userCmd) {
    res.error = new Error("Command must be present")
    return res
  }

  if (!Array.isArray(params) || !params.every((p) => typeof p === 'string' || typeof p === 'number')) {
    // numbers get coerced into strings it seems
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

  // have to use spawn instead of exec or execFile so we can ignore stdin.
  // Otherwise, it breaks the parent process stdin and ctrl +c no longer works.
  let stdoutBuf = '';
  let stderrBuf = '';

  return new Promise((resolve, reject) => {
    execOptions.stdio = ['ignore', 'pipe', 'pipe']
    const child = spawn(cmd, params, execOptions);

    child.stdout.on('data', (data) => {
      stdoutBuf += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderrBuf += data.toString();
    });

    child.on('error', (error) => {
      reject({ stdout: stdoutBuf, stderr: stderrBuf, error })
    })

    child.on('close', (code) => {
      // process.stdout.write(`Exited with code: ${code}\n`)
      resolve({ stdout: stdoutBuf, stderr: stderrBuf, error: null, code })
    });
  })

  // const { stdout, stderr } = await execFile(cmd, params, execOptions).catch((err) => {
  //   const { stdout: errStdout, stderr: errStderr, ...error } = err;
  //   res.error = error;
  //   return { stdout: errStdout, stderr: errStderr };
  // });

  // res.stdout = stdout;
  // res.stderr = stderr;

  // return res;
}

parentPort.on('message', async (message) => {
  const { id, cmd, options } = message;
  const response = await runCommand(cmd, options)
  response.logError = options.logError;
  parentPort.postMessage({ id, response })
});
