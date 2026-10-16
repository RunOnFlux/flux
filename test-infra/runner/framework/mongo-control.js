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
// failpoint needs. A command already held when the failpoint is released waits
// out the rest of its hold. The harness's own database client (dbClient) is held
// with FluxOS, so a suite reads nothing through it meanwhile.

const HELD_COMMANDS = [
  'find', 'aggregate', 'getMore', 'count', 'distinct',
  'insert', 'update', 'delete', 'findAndModify',
  'createIndexes', 'listIndexes', 'dropIndexes', 'drop', 'listCollections',
];

async function failpoint(command) {
  const client = await MongoClient.connect(`mongodb://${getSubnetConfig().mongo}:27017`, { directConnection: true });
  try {
    await client.db('admin').command({ configureFailPoint: 'failCommand', ...command });
  } finally {
    await client.close();
  }
}

export async function holdCommands(holdMs) {
  await failpoint({
    mode: 'alwaysOn',
    data: { failCommands: HELD_COMMANDS, blockConnection: true, blockTimeMS: holdMs },
  });
}

export async function releaseCommands() {
  await failpoint({ mode: 'off' });
}
