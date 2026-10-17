import { expect } from 'chai';
import { listAppContainers } from './container.js';
import { REGISTRY_REPO_HOST } from './subnet-config.js';
import { sleepUnlessInfraDead } from './infra-death.js';

// An app with more than one single-writer (g:) component, as the suites that watch
// its election see it.
//
// The election decides the app, not each component: its primary runs every g:
// component on one node, and every other holder runs none. A node running one of
// them while another node runs any other is the app split across two nodes - the
// load balancer sends all of its ports to one of them, and the components cannot
// reach each other over the app's network - so every wait built from this holds
// that no two nodes run any of its g: components at once.

/**
 * One g: component of the test image, which writes `<name>.txt` into its volume.
 * Ports are left to buildSeedableApp, which allocates them by compose index; a
 * component added by an update takes its own (allocatePortFor(appName, index)).
 * @param {string} appName
 * @param {string} name
 * @returns {object} a compose entry
 */
export function gComponent(appName, name) {
  return {
    name,
    description: `${name} of an app with several writers`,
    repotag: `${REGISTRY_REPO_HOST}/${appName}:v1`,
    ports: [],
    domains: [''],
    environmentParameters: [`WRITE_FILE=/appdata/${name}.txt`, `WRITE_CONTENT=${name}`],
    commands: [],
    containerPorts: [80],
    containerData: 'g:/appdata',
    cpu: 0.1,
    ram: 100,
    hdd: 1,
    repoauth: '',
  };
}

/**
 * What each holder runs of an app's g: components.
 * @param {() => object} getEnv the suite's env, read when called
 * @param {object} opts
 * @param {string} opts.appName
 * @param {string[]} opts.components every g: component name the app has at any
 *   point of the suite, in the order results list them
 * @param {number[]} opts.holders node indices that hold the app
 * @returns {{
 *   folderOf: (name: string) => string,
 *   runningOn: (i: number) => Promise<string[]>,
 *   oneHolderAtMost: () => Promise<Object<number, string[]>>,
 *   holdsFor: (ms: number, expected: Object<number, string[]>) => Promise<void>,
 * }}
 */
export function watchGComponents(getEnv, { appName, components, holders }) {
  const folderOf = (name) => `flux${name}_${appName}`;
  const runningOn = async (i) => {
    const containers = await listAppContainers(getEnv().clients[i].container);
    return components.filter((name) => containers.some((c) => c.name === folderOf(name) && c.status?.startsWith('Up')));
  };
  // Asserted on every call: a waitHolding poll built on it fails at the first breach.
  const oneHolderAtMost = async () => {
    const running = await Promise.all(holders.map(runningOn));
    const runners = holders.filter((_, k) => running[k].length);
    expect(runners.length, `the app runs on more than one node: ${holders.map((i, k) => `node ${i} runs [${running[k]}]`).join(', ')}`).to.be.at.most(1);
    return Object.fromEntries(holders.map((i, k) => [i, running[k]]));
  };
  // Held over a span of election passes, not read once.
  const holdsFor = async (ms, expected) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const running = await oneHolderAtMost();
      expect(running, 'what each holder runs').to.deep.equal(expected);
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(5000);
    }
  };
  return {
    folderOf, runningOn, oneHolderAtMost, holdsFor,
  };
}
