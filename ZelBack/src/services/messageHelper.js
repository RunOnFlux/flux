/**
 * Creates a message object.
 *
 * @param {object} data
 *
 * @returns {object} message
 */
function createDataMessage(data) {
  const successMessage = {
    status: 'success',
    data,
  };
  return successMessage;
}

/**
 * Creates a message object indicating success.
 *
 * @param {string} message
 * @param {string} [name]
 * @param {string} [code]
 *
 * @returns {object} success message
 */
function createSuccessMessage(message, name, code) {
  const successMessage = {
    status: 'success',
    data: {
      code,
      name,
      message,
    },
  };
  return successMessage;
}

/**
 * Creates a message indicating a warning.
 *
 * @param {string} message
 * @param {string} [name]
 * @param {string} [code]
 *
 * @returns {object} warning message
 */
function createWarningMessage(message, name, code) {
  const warningMessage = {
    status: 'warning',
    data: {
      code,
      name,
      message,
    },
  };
  return warningMessage;
}

/**
 * Creates a message indicating an error.
 *
 * @param {string} message
 * @param {string} [name]
 * @param {string} [code]
 *
 * @returns {object} error message
 */
function createErrorMessage(message, name, code) {
  const errMessage = {
    status: 'error',
    data: {
      code,
      name,
      message: message || 'Unknown error',
    },
  };
  return errMessage;
}

/**
 * Returns unauthorized error message.
 *
 * @returns {object} unauthorized error message
 */
function errUnauthorizedMessage() {
  const errMessage = {
    status: 'error',
    data: {
      code: 401,
      name: 'Unauthorized',
      message: 'Unauthorized. Access denied.',
    },
  };
  return errMessage;
}

module.exports = {
  createDataMessage,
  createErrorMessage,
  createSuccessMessage,
  createWarningMessage,
  errUnauthorizedMessage,
};
