process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;

const config = require('config');
const serviceHelper = require('./ZelBack/src/services/serviceHelper');

const globalAppsMessages = config.database.appsglobal.collections.appsMessages;

const txid = 'bbb478930857ceb9b380a887def62a4e5490100f8c11fa9ac53d711077008908';
async function removeTXID() {
  try {
    console.log(`Removing ${txid} record claim from fusion`);
    const db = await serviceHelper.connectMongoDb();
    const database = db.db(config.database.appsglobal.database);
    const query = {
      txid,
    };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    await serviceHelper.findOneAndDeleteInDatabase(database, globalAppsMessages, query, projection);
    console.log('DONE');
  } catch (error) {
    console.log(error);
  }
}

removeTXID();
