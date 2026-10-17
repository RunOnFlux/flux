import { MongoClient } from 'mongodb';
import { getSubnetConfig } from './subnet-config.js';

// The fleet's mongod made to hold the commands FluxOS sends, while it goes on
// answering the driver's heartbeats: what a mongod with one thread stuck in the
// kernel looks like from FluxOS. Every data command waits and none fails, and
// the server still reads as healthy, so nothing but a bound on the call itself
// ends the wait. (A paused container answers no heartbeat either, and the driver
// then fails every call in flight by itself.)
//
// The harness mongod runs with enableTestCommands, which the failCommand
// failpoint needs. The harness's own database client (dbClient) is held with
// FluxOS, so a suite reads nothing through it meanwhile.

const HELD_COMMANDS = [
  'find', 'aggregate', 'getMore', 'count', 'distinct',
  'insert', 'update', 'delete', 'findAndModify',
  'createIndexes', 'listIndexes', 'dropIndexes', 'drop', 'listCollections',
];

async function withAdmin(work) {
  const client = await MongoClient.connect(`mongodb://${getSubnetConfig().mongo}:27017`, { directConnection: true });
  try {
    return await work(client.db('admin'));
  } finally {
    await client.close();
  }
}

export async function holdCommands(holdMs) {
  await withAdmin((admin) => admin.command({
    configureFailPoint: 'failCommand',
    mode: 'alwaysOn',
    data: { failCommands: HELD_COMMANDS, blockConnection: true, blockTimeMS: holdMs },
  }));
}

// Turning the failpoint off waits for every command inside it to leave, and a held
// command stays for the whole hold. So the held commands are killed until the
// release completes: their wait is interruptible, and they leave at once.
export async function releaseCommands() {
  await withAdmin(async (admin) => {
    let released = false;
    const off = admin.command({ configureFailPoint: 'failCommand', mode: 'off' }).finally(() => { released = true; });
    while (!released) {
      // eslint-disable-next-line no-await-in-loop
      const { inprog } = await admin.command({ currentOp: 1, active: true });
      const held = inprog.filter((op) => op.command && HELD_COMMANDS.some((name) => name in op.command));
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(held.map((op) => admin.command({ killOp: 1, op: op.opid }).catch(() => {})));
      // eslint-disable-next-line no-await-in-loop
      await Promise.race([off.catch(() => {}), new Promise((resolve) => { setTimeout(resolve, 1000); })]);
    }
    await off;
  });
}
