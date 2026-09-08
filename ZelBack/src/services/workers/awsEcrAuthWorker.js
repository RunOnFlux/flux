/**
 * AWS ECR auth worker - runs one ECR call for the provider.
 *
 * @aws-sdk/client-ecr is required here, at the top of a worker spawned per call
 * and terminated after it, so the main isolate never carries it. Only the fields
 * the provider consumes are returned; expiresAt survives as a Date because
 * structured clone preserves them.
 */

const { parentPort } = require('worker_threads');
// eslint-disable-next-line import/no-unresolved
const { ECRClient, GetAuthorizationTokenCommand, DescribeRepositoriesCommand } = require('@aws-sdk/client-ecr');

const COMMANDS = {
  getAuthorizationToken: GetAuthorizationTokenCommand,
  describeRepositories: DescribeRepositoriesCommand,
};

parentPort.on('message', async (payload) => {
  try {
    const { operation, clientConfig, params } = payload;

    const Command = COMMANDS[operation];
    if (!Command) throw new Error(`Unsupported ECR operation: ${operation}`);

    const client = new ECRClient(clientConfig);
    const response = await client.send(new Command(params || {}));

    const result = operation === 'getAuthorizationToken'
      ? { authorizationData: response.authorizationData }
      : { ok: true };

    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error.message || String(error) });
  }
});
