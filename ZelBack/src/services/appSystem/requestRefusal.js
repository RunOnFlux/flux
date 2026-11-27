// The failures a request on an app's volume causes itself: what it named is not
// there (ENOENT), the name it gave is taken (EEXIST), the result does not fit the
// volume (ENOSPC), or carrying it out would delete data it never named
// (EDESTRUCTIVE). The caller is answered with the error and its code; the node
// does not log them as its own errors.

const REQUEST_REFUSAL_CODES = new Set(['ENOENT', 'EEXIST', 'ENOSPC', 'EDESTRUCTIVE']);

/**
 * @param {Error} error
 * @returns {boolean} Whether the request caused this failure itself.
 */
function isRequestRefusal(error) {
  return REQUEST_REFUSAL_CODES.has(error?.code);
}

module.exports = { isRequestRefusal };
