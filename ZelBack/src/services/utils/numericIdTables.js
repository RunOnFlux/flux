// The user and group tables syncthing resolves owners against: every id from 0
// to 65535 named by its own decimal number.
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
const TABLES_SHA256 = 'c46c6f336e4b46caec4238e2956a72a12427569d5890ea6a34aaf996b50eee49';

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
 * The passwd table: `<id>:x:<id>:<id>:::` per id.
 * @returns {string}
 */
function passwdTable() {
  return orderedIds().map((id) => `${id}:x:${id}:${id}:::\n`).join('');
}

/**
 * The group table: `<id>:x:<id>:` per id.
 * @returns {string}
 */
function groupTable() {
  return orderedIds().map((id) => `${id}:x:${id}:\n`).join('');
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
