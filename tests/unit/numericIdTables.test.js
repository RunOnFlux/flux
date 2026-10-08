const { expect } = require('chai');

const {
  ID_ORDER, TABLES_SHA256, groupTable, passwdTable, tablesSha256,
} = require('../../ZelBack/src/services/utils/numericIdTables');

describe('numericIdTables', () => {
  const passwd = passwdTable();
  const group = groupTable();
  const passwdLines = passwd.split('\n').slice(0, -1);
  const groupLines = group.split('\n').slice(0, -1);
  const numbered = (lines) => lines.filter((line) => !line.startsWith('root:'));

  // The Arcane image builds its tables by the same rule and checks them against
  // this hash, so the two can only change together.
  it('produces the bytes the Arcane image checks against', () => {
    expect(tablesSha256(passwd, group)).to.equal(TABLES_SHA256);
  });

  it('names every id from 0 to 65535 exactly once, by its own number, in both tables', () => {
    const misnamedPasswd = numbered(passwdLines).filter((line) => {
      const [name, , uid, gid, ...rest] = line.split(':');
      return name !== uid || gid !== uid || rest.join(':') !== '::';
    });
    const misnamedGroup = numbered(groupLines).filter((line) => {
      const [name, , gid, members] = line.split(':');
      return name !== gid || members !== '';
    });
    expect(misnamedPasswd, 'passwd lines not named by their id').to.deep.equal([]);
    expect(misnamedGroup, 'group lines not named by their id').to.deep.equal([]);

    const every = Array.from({ length: 65536 }, (_, id) => id);
    const ids = (lines, field) => lines.map((line) => Number(line.split(':')[field])).sort((a, b) => a - b);
    expect(ids(numbered(passwdLines), 2)).to.deep.equal(every);
    expect(ids(numbered(groupLines), 2)).to.deep.equal(every);
  });

  // A node that resolves host names sends root for id 0 on almost every file;
  // a name missing from the tables is a read of both to the end.
  it('names id 0 root as well, on the line after it, so a lookup by id meets 0 first', () => {
    expect(passwdLines.slice(0, 2)).to.deep.equal(['0:x:0:0:::', 'root:x:0:0:::']);
    expect(groupLines.slice(0, 2)).to.deep.equal(['0:x:0:', 'root:x:0:']);
    expect(passwdLines.filter((line) => line.startsWith('root:'))).to.have.lengthOf(1);
    expect(groupLines.filter((line) => line.startsWith('root:'))).to.have.lengthOf(1);
  });

  it('writes the ids containers use most first', () => {
    const position = (id) => numbered(passwdLines).findIndex((line) => line.startsWith(`${id}:`));
    expect(position(0)).to.equal(0);
    expect(position(2047)).to.equal(2047);
    expect(position(65534), 'nobody').to.equal(2048 + 14);
    expect(position(2048)).to.equal(2048 + 16);
    expect(ID_ORDER).to.deep.equal([[0, 2047], [65520, 65535], [2048, 65519]]);
  });

  it('gives each line the seven passwd fields and four group fields a reader requires', () => {
    expect(passwdLines.every((line) => line.split(':').length === 7)).to.equal(true);
    expect(groupLines.every((line) => line.split(':').length === 4)).to.equal(true);
  });
});
