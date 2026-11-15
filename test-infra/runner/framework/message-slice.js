// A slice of the mainnet app message log (test-infra/fixtures/mainnet-message-slice): every
// permanent message of 198 mainnet apps, 1,050 messages, and a mainnet node's payment record of
// each. Over 500 missing messages is what sends a node's hash sync down its bulk path, so a node
// holding these records without the messages, among peers that hold both, catches up in bulk.
//
// The chain of a suite using it starts above the slice: createTestEnv({ initialHeight:
// manifest.scannedHeight + 1 }).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'mainnet-message-slice');

const readLines = (file) => gunzipSync(readFileSync(join(FIXTURE, file))).toString().trim().split('\n').map((line) => JSON.parse(line));

/**
 * @returns {{manifest: object, messages: object[], records: object[]}} the manifest, the
 *   permanent messages and their payment records
 */
export function loadMessageSlice() {
  return {
    manifest: JSON.parse(readFileSync(join(FIXTURE, 'manifest.json'), 'utf-8')),
    messages: readLines('messages.json.gz'),
    records: readLines('hashes.json.gz'),
  };
}
