/**
 * Service Registry to manage service dependencies and avoid circular dependencies
 * This registry allows services to be registered once and accessed throughout the application
 * without creating circular import chains.
 */

const services = new Map();
const lazyLoaders = new Map();

/**
 * Register a service instance
 * @param {string} name - Service name
 * @param {Object} service - Service instance
 */
function register(name, service) {
  services.set(name, service);
}

/**
 * Register a lazy loader for a service
 * @param {string} name - Service name
 * @param {Function} loader - Function that returns the service (usually a require statement)
 */
function registerLazy(name, loader) {
  lazyLoaders.set(name, loader);
}

/**
 * Get a service by name
 * @param {string} name - Service name
 * @returns {Object} Service instance
 */
function get(name) {
  // If service is already loaded, return it
  if (services.has(name)) {
    return services.get(name);
  }

  // If there's a lazy loader, execute it and cache the result
  if (lazyLoaders.has(name)) {
    const loader = lazyLoaders.get(name);
    const service = loader();
    services.set(name, service);
    return service;
  }

  throw new Error(`Service '${name}' not found in registry`);
}

/**
 * Check if a service is registered
 * @param {string} name - Service name
 * @returns {boolean} True if service is registered
 */
function has(name) {
  return services.has(name) || lazyLoaders.has(name);
}

/**
 * Clear all services (useful for testing)
 */
function clear() {
  services.clear();
  lazyLoaders.clear();
}

module.exports = {
  register,
  registerLazy,
  get,
  has,
  clear,
};
