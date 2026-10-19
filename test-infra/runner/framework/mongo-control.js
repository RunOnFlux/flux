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

// The given commands on one collection of one node fail, as a call the database could
// not complete does, and every other node's go through: each node keeps its data in
// databases of its own (dbClient's prefix). `times` fails that many and then stops; left
// out, every one fails until released. Resolves to a release that turns the failure off
// and resolves to how many commands it failed.
export async function failCommands(nodeNum, database, collection, { commands, times } = {}) {
  const namespace = `node${String(nodeNum).padStart(2, '0')}_${database}.${collection}`;
  await withAdmin((admin) => admin.command({
    configureFailPoint: 'failCommand',
    mode: times === undefined ? 'alwaysOn' : { times },
    data: { failCommands: commands, namespace, errorCode: 91 },
  }));
  return async function release() {
    // turning a failpoint off answers how many times it fired
    const { count } = await withAdmin((admin) => admin.command({ configureFailPoint: 'failCommand', mode: 'off' }));
    return count;
  };
}

// The next `times` writes to one collection of one node fail (failCommands).
export async function failWrites(nodeNum, database, collection, { times = 1 } = {}) {
  return failCommands(nodeNum, database, collection, { commands: ['insert', 'update'], times });
}
