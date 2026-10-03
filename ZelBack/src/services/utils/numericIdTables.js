// The user and group tables syncthing resolves owners against: every id from 0
// to 65535 named by its own decimal number, and id 0 named root as well.
//
// syncthing sends a file's owner as its uid and gid together with the names the
// sending host gives them, and the receiver applies the NAME when it has one.
// It also counts an owner as unchanged when either the numbers or the names
// match. Container ids mean nothing to host user names, so syncthing is given
// these tables in place of the host's: a name is then the number it stands for
// on every host, so an owner arrives as the same id wherever it lands, and two
// different ids always have different names, so a change of owner alone is a
// change. A host without the tables has no user named `999`, and falls back to
// the number.
//
// root is id 0 on every host, so naming it maps nothing wrongly, and it is the
// owner a node that resolves host names sends most. Without it, every such
// lookup reads both tables to the end; on the second line it is found at once.
// A lookup by id meets `0` first, so these tables still send every id as its
// number.
//
// The bytes are the contract. The Arcane image builds the same tables by the
// same rule, and both check them against TABLES_SHA256.

const crypto = require('node:crypto');

// Ids in the order they are written: syncthing reads the file from the top on
// every lookup, so the ids containers use most come first - system and ordinary
// users, then the top of the range (nobody, distroless nonroot), then the rest.
const ID_ORDER = Object.freeze([
  [0, 2047],
  [65520, 65535],
  [2048, 65519],
]);

// sha256 over the passwd bytes followed by the group bytes.
const TABLES_SHA256 = '1f43784b37b17684e792b706cd6741db458eea62a97deaba74fc6ef94a8264b7';

/**
 * Every id the tables name, in the order they are written.
 * @returns {number[]}
 */
function orderedIds() {
  const ids = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const [from, to] of ID_ORDER) {
    for (let id = from; id <= to; id += 1) ids.push(id);
  }
  return ids;
}

/**
 * The passwd table: `<id>:x:<id>:<id>:::` per id, and `root:x:0:0:::` after id 0.
 * @returns {string}
 */
function passwdTable() {
  return orderedIds().map((id) => `${id}:x:${id}:${id}:::\n${id === 0 ? 'root:x:0:0:::\n' : ''}`).join('');
}

/**
 * The group table: `<id>:x:<id>:` per id, and `root:x:0:` after id 0.
 * @returns {string}
 */
function groupTable() {
  return orderedIds().map((id) => `${id}:x:${id}:\n${id === 0 ? 'root:x:0:\n' : ''}`).join('');
}

/**
 * sha256 over the passwd bytes followed by the group bytes.
 * @param {string} passwd
 * @param {string} group
 * @returns {string}
 */
function tablesSha256(passwd, group) {
  return crypto.createHash('sha256').update(passwd).update(group).digest('hex');
}

module.exports = {
  ID_ORDER,
  TABLES_SHA256,
  groupTable,
  passwdTable,
  tablesSha256,
};
