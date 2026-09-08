const log = require('../../lib/log');
const { openNoFollow } = require('./pathSecurity');

/**
 * Send a file to a client, from a handle rather than from a name.
 *
 * The path was checked before this is called, but the application owns the
 * volume and keeps running: it can replace what the name refers to at any
 * moment, including between the check and the send. So the name is used exactly
 * once, and everything afterwards is decided from the descriptor that opening
 * it produced.
 *
 * O_NOFOLLOW refuses to open a symlink at the final component, which is the
 * swap that turns a checked path into somebody else's file. What remains
 * expressible - swapping a parent directory - the earlier path check still
 * covers, and this removes the half of it that a check cannot. Opening also
 * refuses anything that is not a regular file, and refuses to WAIT for one: a
 * named pipe at this path would otherwise hold the request open for as long as
 * the app owner left it there.
 *
 * The length is measured from the same descriptor and the send is capped at it.
 * An application writing to its own file during a download would otherwise make
 * the body longer than the Content-Length already announced, which a client
 * reads as a corrupt response.
 *
 * NOTE: this does not serve range requests. `res.download` did, by way of
 * express, and nothing known asks for them - the dashboard fetches whole files.
 * Accept-Ranges says so rather than leaving a client to discover it. The read
 * below is already a byte range over the handle, so serving one means clamping
 * what the client asked for into that start and end, answering 206 with a
 * Content-Range, and advertising `bytes` here instead.
 *
 * @param {object} res - express response
 * @param {string} filepath - already checked for containment
 * @param {string} filename - what the client is told to call it
 * @returns {Promise<void>}
 */
async function sendFile(res, filepath, filename) {
  // Both from the one open: the handle to send from, and the length as it was
  // at the moment that handle was made. Measuring it again here would be a
  // later answer, and the app is writing to the file the whole time.
  const { handle, stats } = await openNoFollow(filepath);

  res.attachment(filename);
  res.setHeader('Content-Length', String(stats.size));
  res.setHeader('Accept-Ranges', 'none');

  if (stats.size === 0) {
    await handle.close().catch(() => {});
    res.end();
    return;
  }

  // Closed here rather than by the stream, so it is closed on every path -
  // including a client that disconnects part way, which destroys the response
  // and leaves the read stream to be cleaned up rather than ended.
  const stream = handle.createReadStream({ start: 0, end: stats.size - 1, autoClose: false });
  const close = () => handle.close().catch(() => {});

  stream.on('close', close);
  stream.on('error', (error) => {
    log.error(error);
    close();
    // The status line and length are already sent, so there is no way to say
    // what went wrong. Destroying the response is what tells the client the
    // body it received is not the whole file.
    res.destroy();
  });

  // pipe() forwards data and ends the destination; it does not destroy the source
  // when the destination dies. A client that disconnects part way therefore
  // destroys the response and leaves this stream neither ended nor destroyed, so
  // its 'close' never fires and the descriptor above is never released - one
  // leaked per aborted download, on a route a caller can abort at will.
  res.on('close', () => stream.destroy());

  stream.pipe(res);
}

module.exports = { sendFile };
