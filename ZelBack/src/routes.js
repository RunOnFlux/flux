const routeTable = require('./routeTableV1');
const { registerRoutes } = require('./routeBuilder');

module.exports = (app) => registerRoutes(app, routeTable);
