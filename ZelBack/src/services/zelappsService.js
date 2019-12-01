const Docker = require('dockerode');
const stream = require('stream');
const serviceHelper = require('./serviceHelper');
const log = require('../lib/log');

const docker = new Docker();

async function dockerListContainers() {
  const containers = await docker.listContainers().catch((error) => { throw error; });
  return containers;
}

function dockerContainerLogs(container, callback) {
  try {
    const logStream = new stream.PassThrough();
    let logStreamData = '';
    logStream.on('data', (chunk) => {
      logStreamData += chunk.toString('utf8');
    });

    container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    }, (err, mystream) => {
      if (err) {
        callback(err);
      } else {
        try {
          container.modem.demuxStream(mystream, logStream, logStream);
          mystream.on('end', () => {
            logStream.end();
            callback(null, logStreamData);
          });

          setTimeout(() => {
            mystream.destroy();
          }, 2000);
        } catch (error) {
          throw new Error({ message: 'An error obtaining log data of an application has occured' });
        }
      }
    });
  } catch (error) {
    throw new Error({ message: 'An error obtaining log data of an application has occured' });
  }
}

async function listZelApps(req, res) {
  const zelapps = await dockerListContainers().catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    log.error(error);
    res.json(errMessage);
    throw error;
  });
  const zelappsResponse = serviceHelper.createDataMessage(zelapps);
  res.json(zelappsResponse);
}

function zelAppLog(req, res) {
  let { container } = req.params;
  container = container || req.query.command;

  const dockerContainer = docker.getContainer(container);
  dockerContainerLogs(dockerContainer, (error, dataLog) => {
    if (error) {
      const errorResponse = serviceHelper.createErrorMessage(error.message, error.name, error.code);
      res.json(errorResponse);
    } else {
      const containerLogResponse = serviceHelper.createDataMessage(dataLog);
      res.json(containerLogResponse);
    }
  });
}

module.exports = {
  listZelApps,
  zelAppLog,
};
