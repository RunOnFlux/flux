// A test run: an app's containers started from its specification, each at a
// fixed 0.2 CPU and 300 MB, for its owner to see whether they start - entirely
// outside the app machinery. It takes no operation on the app, writes no row, opens no
// host port and creates no syncthing folder. Its containers carry the
// runonflux.role label 'testrun', which no reconciler, monitor or orphan sweep
// acts on, and a name no app container can have.
//
// Everything a run creates is marked so it can be found again and nothing else
// is: its containers and network by the role label and the `testrun-` name
// prefix, the directories its mounts bind under one directory used for nothing
// else, and the images it pulled that the node did not hold, recorded in that
// directory before each pull. A run removes all of it when it ends, and every
// FluxOS start removes what a run that did not end left behind. No run starts
// until that sweep has succeeded.
//
// A container that exited fails the run. A runonflux/orbit (Deploy with Git)
// container is also asked whether its build passed, on its /api/status. Every
// container is removed as soon as it has been judged.
//
// It stands in until FluxOS v9's playground (POST /apps/playground), which
// replaces it, and is not extended.

const crypto = require('node:crypto');
const fs = require('node:fs').promises;
const path = require('node:path');
const config = require('config');
const log = require('../../lib/log');
const dockerService = require('../dockerService');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const IOUtils = require('../IOUtils');
const mountParser = require('../utils/mountParser');
const volumeConstructor = require('../utils/volumeConstructor');
const fluxEventBus = require('../utils/fluxEventBus');
const { appsFolderPath } = require('../utils/appConstants');

const ROLE_LABEL = 'runonflux.role';
const ROLE = 'testrun';
// the run a container or network belongs to
const RUN_LABEL = 'runonflux.testrun';
const NAME_PREFIX = 'testrun-';
// what every test-run container runs at
const TEST_CPU = 0.2;
const TEST_RAM_MB = 300;
// app containers share flux.slice against the system services, and so do these
const CGROUP_PARENT = 'flux.slice';
// Deploy with Git's image, and its build status: polled every ORBIT_POLL_MS for
// up to ORBIT_POLLS polls, a line written each, after ORBIT_FIRST_POLL_MS
const ORBIT_IMAGE = 'runonflux/orbit';
const ORBIT_FIRST_POLL_MS = 5000;
const ORBIT_POLL_MS = 5000;
const ORBIT_POLLS = 24;
// beside the apps folder, on the disk app data is on
const ROOT = path.join(path.dirname(appsFolderPath), 'testruns');
// the images a run pulled that the node did not hold, written before each pull
const PULLED_FILE = 'pulled.json';

let swept = false;
let running = false;

function isTestRunContainer(container) {
  const name = (container.Names && container.Names[0]) || '';
  return container.Labels?.[ROLE_LABEL] === ROLE && name.startsWith(`/${NAME_PREFIX}`);
}

function isTestRunNetwork(network) {
  return network.Labels?.[ROLE_LABEL] === ROLE && (network.Name || '').startsWith(NAME_PREFIX);
}

async function readPulled(runDir) {
  try {
    const recorded = JSON.parse(await fs.readFile(path.join(runDir, PULLED_FILE), 'utf8'));
    return Array.isArray(recorded) ? recorded.filter((image) => typeof image === 'string') : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * The test-run directory, made as root when it does not exist and given to the
 * user FluxOS runs as, which writes everything under it. Rejects when it cannot.
 * @returns {Promise<void>}
 */
async function ensureRoot() {
  try {
    await fs.access(ROOT, fs.constants.W_OK);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error;
  }
  const made = await serviceHelper.runCommand('mkdir', { runAsRoot: true, params: ['-p', ROOT] });
  if (made.error) throw new Error(`${ROOT} could not be made: ${made.error.message}`);
  const owned = await serviceHelper.runCommand('chown', { runAsRoot: true, params: [`${process.getuid()}:${process.getgid()}`, ROOT] });
  if (owned.error) throw new Error(`${ROOT} could not be given to FluxOS: ${owned.error.message}`);
}

/**
 * Removes the test-run containers and networks of one run, or of every run, the
 * images those runs pulled that no remaining container uses, and their
 * directories. Rejects when docker or the directory cannot be read, having
 * removed what it could.
 * @param {string|null} runId One run, or null for every run.
 * @returns {Promise<void>}
 */
async function removeRuns(runId) {
  const ofRun = (labels) => runId === null || labels?.[RUN_LABEL] === runId;

  const containers = (await dockerService.dockerListContainers(true))
    .filter((container) => isTestRunContainer(container) && ofRun(container.Labels));
  // eslint-disable-next-line no-restricted-syntax
  for (const container of containers) {
    // eslint-disable-next-line no-await-in-loop
    await dockerService.appDockerForceRemove(container.Id, true);
  }

  const networks = (await dockerService.dockerListNetworks())
    .filter((network) => isTestRunNetwork(network) && ofRun(network.Labels));
  // eslint-disable-next-line no-restricted-syntax
  for (const network of networks) {
    // eslint-disable-next-line no-await-in-loop
    await dockerService.dockerRemoveNetwork(dockerService.dockerGetNetwork(network.Id));
  }

  let runDirs;
  try {
    runDirs = runId === null
      ? (await fs.readdir(ROOT)).map((entry) => path.join(ROOT, entry))
      : [path.join(ROOT, runId)];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    runDirs = [];
  }
  const pulled = new Set((await Promise.all(runDirs.map(readPulled))).flat());
  if (pulled.size) {
    const inUse = new Set((await dockerService.dockerListContainers(true)).map((container) => container.Image));
    // eslint-disable-next-line no-restricted-syntax
    for (const image of pulled) {
      if (!inUse.has(image)) {
        // eslint-disable-next-line no-await-in-loop
        await dockerService.appDockerImageRemove(image).catch((error) => {
          if (error.statusCode !== 404) throw error;
        });
      }
    }
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const runDir of runDirs) {
    // eslint-disable-next-line no-await-in-loop
    if (!await IOUtils.removeDirectory(runDir)) throw new Error(`${runDir} could not be removed`);
  }
}

/**
 * Removes whatever earlier test runs left on this node. Until it has succeeded,
 * no test run starts.
 * @returns {Promise<void>} Rejects when the sweep did not complete.
 */
async function sweep() {
  await removeRuns(null);
  swept = true;
  log.info('appTestRun - nothing an earlier test run created is left on this node');
  fluxEventBus.publish('testrun:swept', {});
}

/**
 * The bind mounts of one component, each on a directory or file of its own
 * under the run's directory, laid out as an installed app's volumes are: a
 * component's mounts under its name, and a reference to another component's
 * storage on that component's.
 * @param {object} component
 * @param {object[]} components Every component of the app, in compose order.
 * @param {object} appSpecs The app's specification.
 * @param {string} runDir
 * @returns {Promise<object[]>} Docker Mount objects.
 */
async function mountsFor(component, components, appSpecs, runDir) {
  const parsed = mountParser.parseContainerData(component.containerData);
  volumeConstructor.validateMountConfiguration(parsed, appSpecs, component);
  const mounts = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const mount of parsed.allMounts) {
    const owner = mount.componentIndex === undefined ? component : components[mount.componentIndex];
    if (!owner) throw new Error(`${component.name} mounts component ${mount.componentIndex}, which the app does not have`);
    const source = path.join(runDir, owner.name, mount.subdir);
    if (mount.isFile) {
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(path.dirname(source), { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(source, '', { flag: 'a' });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(source, { recursive: true });
    }
    mounts.push({ Type: 'bind', Source: source, Target: mount.containerPath });
  }
  return mounts;
}

/**
 * Creates one component's container in the run.
 * @returns {Promise<object>} The docker container.
 */
async function createContainer(component, appSpecs, runId, networkName, mounts) {
  const { envParams, adjustedCommands } = await dockerService.declaredEnvAndCmd(component);
  const env = [...envParams];
  const cmd = [...adjustedCommands];
  await dockerService.expandStorageAndNodeEnv(env, cmd, appSpecs.name, `${component.name}_${appSpecs.name}`);
  const memory = Math.round(TEST_RAM_MB * 1024 * 1024);
  return dockerService.createContainer({
    Image: component.repotag,
    name: `${NAME_PREFIX}${runId}-${component.name}`,
    Hostname: component.name,
    Cmd: cmd,
    Env: env,
    Tty: false,
    Labels: { [ROLE_LABEL]: ROLE, [RUN_LABEL]: runId },
    HostConfig: {
      CgroupParent: CGROUP_PARENT,
      NanoCPUs: Math.round(TEST_CPU * 1e9),
      Memory: memory,
      MemorySwap: memory,
      Mounts: mounts,
      RestartPolicy: { Name: 'no' },
      NetworkMode: networkName,
      LogConfig: { Type: 'json-file', Config: { 'max-file': '1', 'max-size': '10m' } },
      ExtraHosts: [`fluxnode.service:${config.server.fluxNodeServiceAddress}`],
    },
    NetworkingConfig: {
      EndpointsConfig: {
        // the names the app's components reach each other by
        [networkName]: { Aliases: [`flux${component.name}_${appSpecs.name}`, component.name] },
      },
    },
  });
}

/**
 * Asks a Deploy with Git container whether its build passed: its /api/status
 * answers initialTestStatus once the build has run, with failed and
 * failure_reason when it did not pass. Reached at the container's address on the
 * run's network, on the first port it declares.
 * @param {object} component
 * @param {string} containerId
 * @param {string} networkName
 * @param {string} identifier How the component is named to its owner.
 * @param {function(object): void} tell
 * @returns {Promise<{passed: boolean, reason: string|null}>}
 */
async function orbitBuildResult(component, containerId, networkName, identifier, tell) {
  const port = (component.containerPorts || [])[0];
  if (!port) return { passed: false, reason: 'No ports configured for Orbit component' };
  const inspected = await dockerService.dockerContainerInspect(containerId);
  const address = inspected?.NetworkSettings?.Networks?.[networkName]?.IPAddress;
  if (!address) return { passed: false, reason: `${identifier} has no address on its network` };
  const statusUrl = `http://${address}:${port}/api/status`;
  tell({ status: `Checking Orbit deployment status for ${identifier} on port ${port}...` });
  await serviceHelper.delay(ORBIT_FIRST_POLL_MS);
  for (let attempt = 1; attempt <= ORBIT_POLLS; attempt += 1) {
    let pollStatus = '';
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await serviceHelper.axiosGet(statusUrl, { timeout: ORBIT_POLL_MS });
      if (response.data && response.data.initialTestStatus === true) {
        if (response.data.failed === true) {
          return { passed: false, reason: response.data.failure_reason || 'Unknown failure' };
        }
        tell({ status: `Orbit initial test passed for ${identifier}` });
        return { passed: true, reason: null };
      }
      pollStatus = ` | response: ${JSON.stringify(response.data)}`;
    } catch (error) {
      pollStatus = ` | error: ${error.message}`;
    }
    tell({ status: `Waiting for Orbit initial test... (${attempt * (ORBIT_POLL_MS / 1000)}s/${ORBIT_POLLS * (ORBIT_POLL_MS / 1000)}s)${pollStatus}` });
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(ORBIT_POLL_MS);
  }
  return { passed: false, reason: `Orbit health check timed out: initial test did not complete within ${(ORBIT_POLLS * ORBIT_POLL_MS) / 60000} minutes` };
}

/**
 * Starts an app's containers, reports whether each started (and, for Deploy with
 * Git, whether its build passed), then removes everything the run created. One
 * run at a time on a node.
 * @param {object} appSpecs The app's specification, decrypted.
 * @param {object} res The response the caller streams status to.
 * @param {object} options
 * @param {function(object): Promise<void>} options.pull Verifies and pulls one
 *   component's image.
 * @returns {Promise<boolean>} Whether every container started (and every build passed).
 */
async function run(appSpecs, res, { pull }) {
  const tell = (message) => {
    res.write(serviceHelper.ensureString(message));
    if (res.flush) res.flush();
  };
  if (running) throw new Error('A test run is already in progress on this node; try again once it has finished');
  running = true;
  const runId = crypto.randomBytes(4).toString('hex');
  const runDir = path.join(ROOT, runId);
  const networkName = `${NAME_PREFIX}${runId}`;
  try {
    if (!swept) await sweep();
    const components = (appSpecs.version >= 4 ? appSpecs.compose : [appSpecs]).map((each) => JSON.parse(JSON.stringify(each)));

    await ensureRoot();
    await fs.mkdir(runDir, { recursive: true });
    const pulled = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of components) {
      // eslint-disable-next-line no-await-in-loop
      if (!await dockerService.imageExists(component.repotag)) {
        pulled.push(component.repotag);
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(path.join(runDir, PULLED_FILE), JSON.stringify(pulled));
      }
      tell({ status: `Pulling ${component.repotag}...` });
      // eslint-disable-next-line no-await-in-loop
      await pull(component);
    }

    await dockerService.dockerCreateNetwork({ Name: networkName, Labels: { [ROLE_LABEL]: ROLE, [RUN_LABEL]: runId } });
    const containers = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of components) {
      // eslint-disable-next-line no-await-in-loop
      const mounts = await mountsFor(component, components, appSpecs, runDir);
      // eslint-disable-next-line no-await-in-loop
      containers.push({ component, container: await createContainer(component, appSpecs, runId, networkName, mounts) });
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const { component, container } of containers) {
      // eslint-disable-next-line no-await-in-loop
      await dockerService.appDockerStart(container.id);
      tell({ status: `Started ${component.name}` });
    }

    fluxEventBus.publish('testrun:started', {
      app: appSpecs.name, runId, containers: containers.map(({ component }) => `${NAME_PREFIX}${runId}-${component.name}`),
    });
    let allStarted = true;
    // eslint-disable-next-line no-restricted-syntax
    for (const { component, container } of containers) {
      const identifier = appSpecs.version >= 4 ? `${component.name}_${appSpecs.name}` : appSpecs.name;
      // eslint-disable-next-line no-await-in-loop
      const { State: state } = await dockerService.dockerContainerInspect(container.id);
      if (!state.Running) {
        allStarted = false;
        // eslint-disable-next-line no-await-in-loop
        const logs = await dockerService.dockerContainerLogs(container.id, 20).catch(() => '');
        tell(messageHelper.createErrorMessage(`${component.name} stopped with exit code ${state.ExitCode}${state.OOMKilled ? ' (out of memory)' : ''}. Last log lines: ${String(logs)}`));
      } else if (String(component.repotag).startsWith(ORBIT_IMAGE)) {
        // eslint-disable-next-line no-await-in-loop
        const build = await orbitBuildResult(component, container.id, networkName, identifier, tell);
        if (!build.passed) {
          allStarted = false;
          tell(messageHelper.createErrorMessage(`Orbit deployment failed: ${build.reason}`));
        }
      }
    }
    await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.TESTRUN_BEFORE_REMOVAL, appSpecs.name);
    fluxEventBus.publish('testrun:ended', { app: appSpecs.name, runId, allStarted });
    if (allStarted) tell(messageHelper.createSuccessMessage(`Flux App ${appSpecs.name} successfully installed and launched`));
    return allStarted;
  } finally {
    await removeRuns(runId).catch((error) => {
      swept = false;
      log.error(`appTestRun - what test run ${runId} created was not all removed, and is removed before the next run: ${error.message}`);
    });
    running = false;
  }
}

module.exports = {
  run,
  sweep,
  isTestRunContainer,
  ROOT,
};
