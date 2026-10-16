const config = require('config');
const dbHelper = require('../dbHelper');

const stagingCollection = config.database.appsglobal.collections.appsMessagesStaging;

// Messages are written to the stage in pieces of this many.
const INSERT_PIECE = 1000;

/**
 * Messages fetched from peers and held until this node has verified them, so that fetching runs
 * at the speed of the network and verifying at its own. The stage takes a message only when its
 * hash is one this node is missing and has not staged yet, and keeps it exactly as the peer sent
 * it, placed at the height of this node's own payment record for the hash.
 *
 * One stage exists at a time: opening one discards whatever an earlier one left.
 */
class MessageStage {
  #collection;

  /** @type {Map<string, {hash: string, height: number}>} */
  #missing;

  /** @type {Set<string>} */
  #staged = new Set();

  /** @type {object[]} */
  #unwritten = [];

  /**
   * @param {import('mongodb').Collection} collection
   * @param {Map<string, {hash: string, height: number}>} missing this node's payment record of
   *   each hash it is missing, keyed by hash
   */
  constructor(collection, missing) {
    this.#collection = collection;
    this.#missing = missing;
  }

  /**
   * @param {Map<string, {hash: string, height: number}>} missing this node's payment record of
   *   each hash it is missing, keyed by hash
   * @returns {Promise<MessageStage>}
   */
  static async open(missing) {
    const db = dbHelper.databaseConnection();
    const collection = db.db(config.database.appsglobal.database).collection(stagingCollection);
    await collection.drop().catch(ignoreMissingCollection);
    await collection.createIndex({ height: 1 });
    return new MessageStage(collection, missing);
  }

  /** The number of messages staged. */
  get size() {
    return this.#staged.size;
  }

  /**
   * Stages a message a peer sent, when this node is missing it and has not staged it yet.
   * @param {object} message
   */
  async add(message) {
    const record = this.#missing.get(message?.hash);
    if (!record || this.#staged.has(message.hash)) return;
    this.#staged.add(message.hash);
    this.#unwritten.push({ hash: message.hash, height: record.height, message });
    if (this.#unwritten.length >= INSERT_PIECE) await this.flush();
  }

  /** Writes the messages staged since the last write. */
  async flush() {
    if (this.#unwritten.length === 0) return;
    const documents = this.#unwritten;
    this.#unwritten = [];
    await this.#collection.insertMany(documents, { ordered: false });
  }

  /**
   * The heights, ascending, of this node's payment records for the missing hashes not staged.
   * @returns {number[]}
   */
  unstagedHeights() {
    const heights = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const record of this.#missing.values()) {
      if (!this.#staged.has(record.hash)) heights.push(record.height);
    }
    return heights.sort((a, b) => a - b);
  }

  /**
   * The staged messages in height order, in batches of at least `size` messages that never split
   * one block's messages. Each batch is its own query, so a batch may take as long to verify as it
   * needs.
   * @param {number} size
   * @returns {AsyncGenerator<object[]>}
   */
  async* batches(size) {
    await this.flush();
    let below = -1;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const next = await this.#collection.find({ height: { $gt: below } }, { projection: { _id: 0 } })
        .sort({ height: 1 }).limit(size).toArray();
      if (next.length === 0) return;
      const lastHeight = next[next.length - 1].height;
      // eslint-disable-next-line no-await-in-loop
      const lastBlock = await this.#collection.find({ height: lastHeight }, { projection: { _id: 0 } }).toArray();
      yield [...next.filter((staged) => staged.height < lastHeight), ...lastBlock].map((staged) => staged.message);
      below = lastHeight;
    }
  }

  /** Removes the stage and everything in it. */
  async discard() {
    this.#unwritten = [];
    await this.#collection.drop().catch(ignoreMissingCollection);
  }
}

/**
 * @param {Error & {codeName?: string}} error
 */
function ignoreMissingCollection(error) {
  if (error.codeName !== 'NamespaceNotFound') throw error;
}

module.exports = { MessageStage };
