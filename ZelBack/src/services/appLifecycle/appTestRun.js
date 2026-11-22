// A test run: an app's containers started from its specification, at the
// resources it declares, for its owner to see whether it runs - entirely outside
// the app machinery. It takes no operation on the app, writes no row, opens no
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
const generalService = require('../generalService');
const IOUtils = require('../IOUtils');
const hwRequirements = require('../appRequirements/hwRequirements');
const mountParser = require('../utils/mountParser');
const volumeConstructor = require('../utils/volumeConstructor');
const { fluxDirPath } = require('../utils/appConstants');

const ROLE_LABEL = 'runonflux.role';
const ROLE = 'testrun';
// the run a container or network belongs to
const RUN_LABEL = 'runonflux.testrun';
const NAME_PREFIX = 'testrun-';
const ROOT = path.join(fluxDirPath, 'testruns');
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
    await dockerService.getDockerContainer(container.Id).remove({ force: true, v: true });
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
  const memory = Math.round(component.ram * 1024 * 1024);
  return dockerService.createContainer({
    Image: component.repotag,
    name: `${NAME_PREFIX}${runId}-${component.name}`,
    Hostname: component.name,
    Cmd: cmd,
    Env: env,
    Tty: false,
    Labels: { [ROLE_LABEL]: ROLE, [RUN_LABEL]: runId },
    HostConfig: {
      NanoCPUs: Math.round(component.cpu * 1e9),
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
 * Runs an app's containers for the test-run window and reports how each fared,
 * then removes everything the run created. One run at a time on a node.
 * @param {object} appSpecs The app's specification, decrypted.
 * @param {object} res The response the caller streams status to.
 * @param {object} options
 * @param {function(object): Promise<void>} options.pull Verifies and pulls one
 *   component's image.
 * @returns {Promise<boolean>} Whether every container was still running at the end.
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
    const tier = await generalService.nodeTier();
    const shortfall = await hwRequirements.hwShortfall(appSpecs);
    if (shortfall) throw new Error(`Refused: this node cannot run ${appSpecs.name} at the resources it declares - ${shortfall}`);
    const components = (appSpecs.version >= 4 ? appSpecs.compose : [appSpecs]).map((each) => {
      const component = JSON.parse(JSON.stringify(each));
      component.cpu = component[`cpu${tier}`] || component.cpu;
      component.ram = component[`ram${tier}`] || component.ram;
      return component;
    });

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
      await container.start();
      tell({ status: `Started ${component.name} at ${component.cpu} CPU and ${component.ram} MB RAM` });
    }

    const watchMs = config.fluxapps.testRunWatchMs;
    tell({ status: `Watching ${appSpecs.name} for ${Math.round(watchMs / 1000)} seconds...` });
    await serviceHelper.delay(watchMs);

    let allRunning = true;
    // eslint-disable-next-line no-restricted-syntax
    for (const { component, container } of containers) {
      // eslint-disable-next-line no-await-in-loop
      const { State: state } = await container.inspect();
      if (state.Running) {
        tell({ status: `${component.name} is running` });
      } else {
        allRunning = false;
        // eslint-disable-next-line no-await-in-loop
        const logs = await dockerService.dockerContainerLogs(container.id, 20).catch(() => '');
        tell(messageHelper.createErrorMessage(`${component.name} stopped with exit code ${state.ExitCode}${state.OOMKilled ? ' (out of memory)' : ''}. Last log lines: ${String(logs)}`));
      }
    }
    tell(allRunning
      ? messageHelper.createSuccessMessage(`${appSpecs.name} ran at the resources it declares. Nothing was installed.`)
      : messageHelper.createErrorMessage(`${appSpecs.name} did not keep running. Nothing was installed.`));
    return allRunning;
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
