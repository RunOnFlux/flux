import { getContainerRuntimeClient } from 'testcontainers';

// The fleet's one mongod, held still and let go. A paused container keeps its
// sockets open and answers nothing, which is what a mongod whose thread is stuck
// in the kernel looks like from FluxOS: every call waits, none fails. The harness's
// own database client (dbClient) waits with it, so a suite reads nothing through it
// while mongod is paused.

async function mongoContainer(env) {
  const client = await getContainerRuntimeClient();
  return client.container.dockerode.getContainer(env.containers.mongo.getId());
}

export async function pauseMongo(env) {
  await (await mongoContainer(env)).pause();
}

export async function resumeMongo(env) {
  await (await mongoContainer(env)).unpause();
}
