// The boot step that keeps installed enterprise app rows to their encrypted specification.

const chai = require('chai');
const config = require('config');

const dbHelper = require('../../ZelBack/src/services/dbHelper');
const { blankStoredEnterpriseSecrets } = require('../../ZelBack/src/services/migrations/enterpriseRows');
const { requireMongo, releaseMongo } = require('./dbTestHelper');

const { expect } = chai;

describe('enterprise app rows boot step', () => {
  after(releaseMongo);

  before(requireMongo);

  let apps;
  const component = { name: 'web', repotag: 'owner/image:1', environmentParameters: ['TOKEN=secret'] };
  const contact = 'owner@example.com';
  const row = (name, fields) => ({
    version: 8, name, owner: '1Owner', hash: `hash${name}`, height: 1900000, expire: 22000, instances: 3, enterprise: 'sealed', compose: [], contacts: [], ...fields,
  });
  const stored = async (name) => apps.findOne({ name }, { projection: { _id: 0 } });

  beforeEach(async () => {
    const db = dbHelper.databaseConnection();
    apps = db.db(config.database.appslocal.database).collection(config.database.appslocal.collections.appsInformation);
    await apps.deleteMany({});
  });

  afterEach(async () => {
    await apps.deleteMany({});
  });

  it('blanks the components and contacts of an enterprise row holding them, and keeps every other field', async () => {
    await apps.insertOne(row('opened', { compose: [component], contacts: [contact] }));

    expect(await blankStoredEnterpriseSecrets()).to.equal(1);
    expect(await stored('opened')).to.deep.equal(row('opened'));
  });

  it('blanks an enterprise row holding only its components, or only its contacts', async () => {
    await apps.insertMany([row('components', { compose: [component] }), row('contacts', { contacts: [contact] })]);

    expect(await blankStoredEnterpriseSecrets()).to.equal(2);
    expect(await stored('components')).to.deep.equal(row('components'));
    expect(await stored('contacts')).to.deep.equal(row('contacts'));
  });

  it('leaves a blank enterprise row, a non-enterprise v8 row and an older version as they are', async () => {
    const rows = [
      row('sealed'),
      row('open', { enterprise: '', compose: [component], contacts: [contact] }),
      { version: 7, name: 'older', owner: '1Owner', compose: [component], contacts: [contact] },
    ];
    await apps.insertMany(rows.map((r) => ({ ...r })));

    expect(await blankStoredEnterpriseSecrets()).to.equal(0);
    expect(await stored('sealed')).to.deep.equal(rows[0]);
    expect(await stored('open')).to.deep.equal(rows[1]);
    expect(await stored('older')).to.deep.equal(rows[2]);
  });

  it('changes nothing on a second run', async () => {
    await apps.insertOne(row('opened', { compose: [component], contacts: [contact] }));

    await blankStoredEnterpriseSecrets();

    expect(await blankStoredEnterpriseSecrets()).to.equal(0);
    expect(await stored('opened')).to.deep.equal(row('opened'));
  });
});
