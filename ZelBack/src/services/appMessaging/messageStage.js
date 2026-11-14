const config = require('config');
const { BSON } = require('mongodb');
const dbHelper = require('../dbHelper');

const stagingCollection = config.database.appsglobal.collections.appsMessagesStaging;

// Messages are written to the stage in pieces of this many.
const INSERT_PIECE = 1000;

// The deepest a message the stage takes may nest objects and arrays. No valid app message comes
// near it; the database refuses a document nested far deeper, and with it every document of its
// piece.
const MAX_MESSAGE_DEPTH = 32;

/**
 * Messages fetched from peers and held until this node has verified them, so that fetching runs
 * at the speed of the network and verifying at its own. The stage takes a message only when its
 * hash is one this node is missing and has not staged yet, and keeps it exactly as the peer sent
 * it, placed at the height of this node's own payment record for the hash.
 *
 * A message the database cannot store (a field name holding a null character, or objects and
 * arrays nested deeper than MAX_MESSAGE_DEPTH), or one over config.fluxapps.gossipMessageMaxBytes,
 * the largest a node takes from a peer, is not taken: no valid app message is any of these, and its
 * hash is left for the next peer. A hash counts as staged once the database holds its message; a
 * piece whose write fails leaves unstaged every hash whose message the database does not hold.
 *
 * One stage exists at a time: opening one discards whatever an earlier one left.
 */
class MessageStage {
  #collection;

  /** @type {Map<string, {hash: string, height: number}>} */
  #missing;

  /** @type {Set<string>} hashes whose message is written */
  #staged = new Set();

  /** @type {object[]} documents taken and not yet written */
  #unwritten = [];

  /** @type {Set<string>} the hashes of #unwritten */
  #pending = new Set();

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
    // A message written by a piece whose write failed part way is refused when it is taken again.
    await collection.createIndex({ hash: 1 }, { unique: true });
    return new MessageStage(collection, missing);
  }

  /** The number of messages staged. */
  get size() {
    return this.#staged.size;
  }

  /**
   * Stages a message a peer sent, when this node is missing it and has not staged it yet.
   * @param {object} message
   * @returns {Promise<boolean>} false when the message is one the stage does not take: one the
   *   database cannot store, or one over the largest a node takes from a peer
   */
  async add(message) {
    const record = this.#missing.get(message?.hash);
    if (!record || this.#staged.has(message.hash) || this.#pending.has(message.hash)) return true;
    if (nestedDeeperThan(message, MAX_MESSAGE_DEPTH)) return false;
    const document = { hash: message.hash, height: record.height, message };
    try {
      if (BSON.serialize(document).length > config.fluxapps.gossipMessageMaxBytes) return false;
    } catch {
      return false;
    }
    this.#pending.add(message.hash);
    this.#unwritten.push(document);
    if (this.#unwritten.length >= INSERT_PIECE) await this.flush();
    return true;
  }

  /**
   * Writes the messages taken since the last write, and stages each one the database then holds.
   * When the write fails, in any way, the database is asked which messages of the piece it holds,
   * and only those are staged; the rest are taken again from the next peer that sends them.
   * Rejects when any message of the piece is not held, or the database cannot say.
   */
  async flush() {
    if (this.#unwritten.length === 0) return;
    const documents = this.#unwritten;
    this.#unwritten = [];
    this.#pending.clear();
    try {
      await this.#collection.insertMany(documents, { ordered: false });
    } catch (error) {
      const hashes = documents.map((document) => document.hash);
      const held = await this.#collection.find({ hash: { $in: hashes } }, { projection: { _id: 0, hash: 1 } }).toArray()
        .catch(() => []);
      held.forEach((document) => this.#staged.add(document.hash));
      if (held.length < documents.length) throw error;
      return;
    }
    documents.forEach((document) => this.#staged.add(document.hash));
  }

  /**
   * The heights, ascending, of this node's payment records for the missing hashes not staged.
   * @returns {number[]}
   */
  unstagedHeights() {
    const heights = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const record of this.#missing.values()) {
      if (!this.#staged.has(record.hash) && !this.#pending.has(record.hash)) heights.push(record.height);
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
    this.#pending.clear();
    await this.#collection.drop().catch(ignoreMissingCollection);
  }
}

/**
 * Whether a parsed JSON value nests objects and arrays more than `limit` deep, the value itself
 * being the first level.
 * @param {unknown} value
 * @param {number} limit
 * @returns {boolean}
 */
function nestedDeeperThan(value, limit) {
  const open = [[value, 1]];
  while (open.length > 0) {
    const [node, depth] = open.pop();
    if (node !== null && typeof node === 'object') {
      if (depth > limit) return true;
      // eslint-disable-next-line no-restricted-syntax
      for (const child of Object.values(node)) open.push([child, depth + 1]);
    }
  }
  return false;
}

/**
 * @param {Error & {codeName?: string}} error
 */
function ignoreMissingCollection(error) {
  if (error.codeName !== 'NamespaceNotFound') throw error;
}

module.exports = { MessageStage };
