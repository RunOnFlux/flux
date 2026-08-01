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

/**
 * The data of an in-band service response, or a throw for an error message.
 * Service-to-service consumers read through this so a transport failure
 * converted to an in-band error shape can never impersonate an empty result:
 * internal code reasons about data or an exception, never a shape union. The
 * HTTP handler surface keeps returning the messages themselves.
 * @param {object} response A createDataMessage/createErrorMessage-shaped object
 * @returns {*} The success message's data
 * @throws {Error} Carrying the error message's message, name and code
 */
function dataOrThrow(response) {
  if (response && response.status === 'success') return response.data;
  const details = (response && typeof response.data === 'object' && response.data) || {};
  const error = new Error(details.message || 'service request failed');
  if (details.name) error.name = details.name;
  if (details.code !== undefined) error.code = details.code;
  throw error;
}

module.exports = {
  createDataMessage,
  createErrorMessage,
  createSuccessMessage,
  createWarningMessage,
  dataOrThrow,
  errUnauthorizedMessage,
};
