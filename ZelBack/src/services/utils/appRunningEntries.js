/**
 * The app entries of a version 2 apprunning message that can be stored, and the
 * ones that cannot. An entry is a location row only with a string name and a
 * string hash. Entries are judged one at a time, so an entry that fails costs
 * its sender that entry and not the rest of the message.
 *
 * The announcer applies the same rule to what it sends, so a node never
 * announces an entry its peers refuse.
 * @param {Array<*>} apps The message's apps.
 * @returns {{stored: Array<object>, refused: Array<*>}} Storable entries and the rest.
 */
function appRunningEntries(apps) {
  const stored = [];
  const refused = [];
  for (const app of apps) {
    if (app && typeof app === 'object' && typeof app.name === 'string' && typeof app.hash === 'string') {
      stored.push(app);
    } else {
      refused.push(app);
    }
  }
  return { stored, refused };
}

module.exports = { appRunningEntries };
