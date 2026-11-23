// When a docker image may leave this node: when nothing wants it.
//
// An image is wanted while
//   - a container references it, running or stopped (docker's own list, by the
//     reference the container was created with and by image id),
//   - it is FluxOS's own file-operation image (fluxapps.volumeOperations: its
//     reference and pinned ids), which runs only while a file operation does, or
//   - anything may be between pulling an image and creating its container: an
//     install, redeploy or rebuild holding its app, or a test run in progress
//     (holdImages). While one is, nothing is removed and a later pass takes it.
// Every image this node removes goes through reclaimImages, so no removal site
// decides on its own. pruneUnusedImages offers every image on the node to it, at
// boot, every imageReapPeriod blocks, after the image update check and after a
// test run.
//
// The check that nothing is being built and the call that removes the image run
// in one synchronous step, with no await between them: an operation that starts
// after the check pulls after the removal was sent, and so pulls the image again.
// Keep it so.
//
// A tagged image is removed by its tags, the last of which removes the image; an
// image with no tag by its id. A removal docker refuses because something still
// uses the image (409), or of an image already gone (404), is the answer it
// should be, not a fault. Nothing is forced.

const config = require('config');
const log = require('../../lib/log');
const dockerService = require('../dockerService');
const operationRegistry = require('../utils/operationRegistry');
const fluxEventBus = require('../utils/fluxEventBus');

// what needs images outside the operation registry, while it runs
let holders = 0;

/**
 * Holds every image on the node for work that pulls images without holding an
 * app (a test run), until the returned function is called.
 * @returns {function(): void} Lets the hold go; a second call does nothing.
 */
function holdImages() {
  holders += 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders -= 1;
  };
}

// FluxOS's own image, by the reference it is pulled as and the ids it is pinned to
function ownImage() {
  const { image, imageIds = {}, indexId } = config.fluxapps.volumeOperations;
  return { ids: new Set([...Object.values(imageIds), indexId].filter(Boolean)), references: new Set([image].filter(Boolean)) };
}

function somethingBuilding() {
  return holders > 0 || operationRegistry.anyHeldOfType('install', 'redeploy', 'rebuild');
}

async function containerReferences() {
  const containers = await dockerService.dockerListContainers(true);
  const ids = new Set();
  const names = new Set();
  (containers || []).forEach((container) => {
    if (container.ImageID) ids.add(container.ImageID);
    if (container.Image) names.add(container.Image);
  });
  return { ids, names };
}

/**
 * Removes the given images that nothing wants.
 * @param {Array<{id: (string|undefined), references: string[]}>} images Each
 *   image as its id, where known, and the references to remove it by.
 * @param {object} [options]
 * @param {function(string): void} [options.report] Told what happens to each image.
 * @returns {Promise<{removed: number, kept: number, deferred: number}>}
 */
async function reclaim(images, { report = () => {} } = {}) {
  const outcome = { removed: 0, kept: 0, deferred: 0 };
  if (!images.length) return outcome;
  const own = ownImage();
  let referenced;
  try {
    referenced = await containerReferences();
  } catch (error) {
    log.warn(`imageReaper - nothing removed: the containers could not be listed (${error.message})`);
    outcome.deferred = images.length;
    return outcome;
  }
  // eslint-disable-next-line no-restricted-syntax
  for (const image of images) {
    if ((image.id && own.ids.has(image.id)) || image.references.some((reference) => own.references.has(reference) || own.ids.has(reference))) {
      outcome.kept += 1;
      // eslint-disable-next-line no-continue
      continue;
    }
    if ((image.id && referenced.ids.has(image.id)) || image.references.some((reference) => referenced.names.has(reference))) {
      outcome.kept += 1;
      report(`Image ${image.references[0]} is used by a container; left`);
      // eslint-disable-next-line no-continue
      continue;
    }
    let deferred = false;
    let failed = false;
    // eslint-disable-next-line no-restricted-syntax
    for (const reference of image.references) {
      // the check and the removal in one synchronous step (header)
      const removal = somethingBuilding() ? null : dockerService.appDockerImageRemove(reference);
      if (!removal) {
        deferred = true;
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await removal.catch((error) => {
        if (error.statusCode === 404) return;
        failed = true;
        if (error.statusCode === 409) {
          report(`Image ${reference} is still in use; left`);
          return;
        }
        log.error(`imageReaper - ${reference} could not be removed: ${error.message}`);
      });
      if (failed) break;
    }
    if (deferred) {
      outcome.deferred += 1;
      report(`Image ${image.references[0]} left for a later pass: an app is being built`);
    } else if (failed) {
      outcome.kept += 1;
    } else {
      outcome.removed += 1;
      report(`Image ${image.references[0]} removed`);
    }
  }
  return outcome;
}

/**
 * Removes these images, named by the references an app gave them, if nothing wants them.
 * @param {string[]} references
 * @param {object} [options]
 * @param {function(string): void} [options.report]
 * @returns {Promise<{removed: number, kept: number, deferred: number}>}
 */
function reclaimImages(references, options) {
  const distinct = [...new Set((references || []).filter(Boolean))];
  return reclaim(distinct.map((reference) => ({ id: undefined, references: [reference] })), options);
}

/**
 * Removes every image on this node that nothing wants.
 * @returns {Promise<{removed: number, kept: number, deferred: number}>}
 */
async function pruneUnusedImages() {
  let listed;
  try {
    listed = await dockerService.dockerListImages();
  } catch (error) {
    log.warn(`imageReaper - nothing removed: the images could not be listed (${error.message})`);
    return { removed: 0, kept: 0, deferred: 0 };
  }
  const images = (listed || []).map((image) => {
    const tags = (image.RepoTags || []).filter((tag) => tag && tag !== '<none>:<none>');
    return { id: image.Id, references: tags.length ? tags : [image.Id] };
  });
  const outcome = await reclaim(images);
  if (outcome.removed || outcome.deferred) {
    log.info(`imageReaper - removed ${outcome.removed} image(s), kept ${outcome.kept}, left ${outcome.deferred} for a later pass`);
  }
  fluxEventBus.publish('images:reaped', outcome);
  return outcome;
}

module.exports = {
  holdImages,
  reclaimImages,
  pruneUnusedImages,
};
