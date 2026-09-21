// Records docker's own answers for the dockerService tests, so those tests can run
// against a response docker really gave rather than one written by hand.
//
// Needs the website container up, the same one the suite used to require:
//
//   docker rm -f fluxwebsite; docker run --rm -d --name fluxwebsite runonflux/website
//   node tests/unit/fixtures/docker/record.js
//
// Re-record after a dockerode major upgrade or a docker API bump: the fixtures are a
// snapshot, so a change in what docker returns is only caught when someone re-records.

const fs = require('fs');
const path = require('path');
const Docker = require('dockerode');

const CONTAINER = 'fluxwebsite';
const IMAGE = 'runonflux/website';

// The same default construction dockerService uses, so the recorded shapes are the
// ones the product's own client produces.
const docker = new Docker();

function write(name, value) {
  const file = path.join(__dirname, `${name}.live.json`);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

async function main() {
  const containers = await docker.listContainers({ all: true });
  const container = containers.find((c) => c.Names.includes(`/${CONTAINER}`));
  if (!container) throw new Error(`${CONTAINER} is not running - see the header of this file`);

  const images = await docker.listImages();
  const image = images.find((i) => (i.RepoTags || []).some((t) => t.startsWith(IMAGE)));
  if (!image) throw new Error(`no ${IMAGE} image locally`);

  const handle = docker.getContainer(container.Id);

  write('container-listing', container);
  write('image-listing', image);
  write('inspect', await handle.inspect());
  write('stats', await handle.stats({ stream: false }));
  write('changes', await handle.changes());
  write('top', await handle.top());

  // Kept as base64: these are docker's framed log bytes, not text, and the frame
  // headers do not survive a round trip through a JSON string.
  const logs = await handle.logs({ stdout: true, stderr: true, tail: 5 });
  write('logs', { base64: Buffer.from(logs).toString('base64') });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
